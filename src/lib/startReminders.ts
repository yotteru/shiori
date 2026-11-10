import { itemsByStart } from './calendar';
import { addDays, weekday } from './lifeDate';
import { activeSession } from './records';
import type { Meta, Plan, StartSession } from './types';

// 予定の開始時刻の通知（2026-11-08。要件メモ「始める瞬間の綱引きへの対策」）。
// 今日・明日の行き先から「いつ・どの文面で送るか」を計算し、端末ごとにサーバーへ丸ごと渡す（Web プッシュ）。
// 文面に {行き先} を書いたときだけ、行き先の名前がサーバーに置かれる（送ったら消える）

export type StartReminderSettings = NonNullable<Meta['startReminder']>;

export const NAME_TOKEN = '{行き先}';

export const DEFAULT_START_REMINDER: StartReminderSettings = {
  enabled: false,
  leadMinutes: 0,
  target: 'all',
  template: '次の行き先の時間です',
};

export const LEAD_CHOICES = [0, 5, 10, 15, 30];

export type EndReminderSettings = NonNullable<Meta['endReminder']>;

export const DEFAULT_END_REMINDER: EndReminderSettings = {
  enabled: false,
  template: '予定の終わりの時間です。済をつけますか',
};

export function endReminderSettings(meta?: Meta): EndReminderSettings {
  return { ...DEFAULT_END_REMINDER, ...meta?.endReminder };
}

export function startReminderSettings(meta?: Meta): StartReminderSettings {
  return { ...DEFAULT_START_REMINDER, ...meta?.startReminder };
}

export function reminderBody(template: string, title: string, fallback = DEFAULT_START_REMINDER.template): string {
  const t = template.trim() || fallback;
  return t.split(NAME_TOKEN).join(title).slice(0, 200);
}

/** 生活日とその日の 0:00 からの分 → 実際の時刻（JST） */
export function startInstant(lifeDate: string, minuteOfDay: number): number {
  return Date.parse(`${lifeDate}T00:00:00+09:00`) + minuteOfDay * 60_000;
}

export interface ReminderItem {
  send_at: string;
  body: string;
}

/**
 * 送る予定の一覧。今日と明日の、まだ済でも未でもない行き先が対象。
 * いま始めている行き先と、過ぎた時刻は除く。target='first' はその日の最初の行き先だけ
 */
export const WEEK_REMINDER_MINUTE = 21 * 60;
export const WEEK_REMINDER_BODY = '来週の見通しを見ておきますか（しおりタブの「週」）';

export function buildStartReminders(
  plans: Plan[],
  today: string,
  settings: StartReminderSettings,
  sessions: StartSession[],
  nowMs: number,
  weekReminder = false,
  end: EndReminderSettings = DEFAULT_END_REMINDER,
): ReminderItem[] {
  const out: ReminderItem[] = [];
  // 日曜の夜の「来週の見通し」（今日・明日のうち日曜の21時）
  if (weekReminder) {
    for (const date of [today, addDays(today, 1)]) {
      if (weekday(date) !== 0) continue;
      const at = startInstant(date, WEEK_REMINDER_MINUTE);
      if (at > nowMs) out.push({ send_at: new Date(at).toISOString(), body: WEEK_REMINDER_BODY });
    }
  }
  const active = activeSession(sessions);
  for (const date of [today, addDays(today, 1)]) {
    const plan = plans.find((p) => p.lifeDate === date);
    if (!plan) continue;
    const items = itemsByStart(plan);
    // 終わる時刻（2026-11-10）を先に入れる（まとめたとき「○○の終わり／△△の時間」の順に読めるように）：済でも未でもない予定。始めている最中のものも知らせる
    if (end.enabled) {
      for (const i of items) {
        if (i.status !== 'planned') continue;
        const at = startInstant(date, i.start + i.minutes);
        if (at <= nowMs) continue;
        out.push({ send_at: new Date(at).toISOString(), body: reminderBody(end.template, i.title, DEFAULT_END_REMINDER.template) });
      }
    }
    if (settings.enabled) {
      const targets = settings.target === 'first' ? items.slice(0, 1) : items;
      for (const i of targets) {
        if (i.status !== 'planned' || active?.planItemId === i.id) continue;
        const at = startInstant(date, i.start - settings.leadMinutes);
        if (at <= nowMs) continue;
        out.push({ send_at: new Date(at).toISOString(), body: reminderBody(settings.template, i.title) });
      }
    }
  }
  return mergeSameTime(out).slice(0, 50);
}

/** 同じ時刻の知らせは1通にまとめる（終わりと次の始まりが重なるときなど。2026-11-10） */
export function mergeSameTime(items: ReminderItem[]): ReminderItem[] {
  const byTime = new Map<string, string[]>();
  for (const x of items) byTime.set(x.send_at, [...(byTime.get(x.send_at) ?? []), x.body]);
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([send_at, bodies]) => ({ send_at, body: [...new Set(bodies)].join('／').slice(0, 200) }));
}

// ---- サーバーへ渡す（同じ内容は送り直さない） ----

let lastSent: string | null = null;

/** 計算した一覧をサーバーへ。前回と同じなら何もしない。送れなければ次の変化で送り直す */
export async function pushStartReminders(items: ReminderItem[], send: (items: ReminderItem[]) => Promise<boolean>): Promise<void> {
  const sig = JSON.stringify(items);
  if (sig === lastSent) return;
  try {
    if (await send(items)) lastSent = sig;
  } catch {
    // 圏外など。次に計画が変わったときか、開き直したときに送り直す
  }
}

/** 端末の通知を登録し直したときなどに、次の計算で必ず送り直す */
export function forgetSentStartReminders() {
  lastSent = null;
}
