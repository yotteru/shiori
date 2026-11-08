import { itemsByStart } from './calendar';
import { addDays } from './lifeDate';
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

export function startReminderSettings(meta?: Meta): StartReminderSettings {
  return { ...DEFAULT_START_REMINDER, ...meta?.startReminder };
}

export function reminderBody(template: string, title: string): string {
  const t = template.trim() || DEFAULT_START_REMINDER.template;
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
export function buildStartReminders(
  plans: Plan[],
  today: string,
  settings: StartReminderSettings,
  sessions: StartSession[],
  nowMs: number,
): ReminderItem[] {
  if (!settings.enabled) return [];
  const active = activeSession(sessions);
  const out: ReminderItem[] = [];
  for (const date of [today, addDays(today, 1)]) {
    const plan = plans.find((p) => p.lifeDate === date);
    if (!plan) continue;
    const items = itemsByStart(plan);
    const targets = settings.target === 'first' ? items.slice(0, 1) : items;
    for (const i of targets) {
      if (i.status !== 'planned' || active?.planItemId === i.id) continue;
      const at = startInstant(date, i.start - settings.leadMinutes);
      if (at <= nowMs) continue;
      out.push({ send_at: new Date(at).toISOString(), body: reminderBody(settings.template, i.title) });
    }
  }
  return out.sort((a, b) => a.send_at.localeCompare(b.send_at)).slice(0, 50);
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
