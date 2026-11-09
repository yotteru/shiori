import { nowIso, realNowIso } from './clock';
import { db, type ShioriDB } from './db';
import { newId } from './id';
import { lifeMinuteToIso } from './lifeDate';
import type { Plan, StartSession } from './types';

// 始めた記録（2026-11-08「5分だけで始める」の見直し。要件メモ「始める瞬間の綱引きへの対策」）。
// 画面のタイマーは置かない。始めた時刻を残し、終えたとき（済・ここまで）に実際の時間が決まる

/** 「ここまで」の理由の候補（設定で変えられる） */
export const DEFAULT_STOP_REASONS = ['疲れた', '時間切れ', '気が乗らない', '割り込み', 'キリがいい'];

// ---- 書き込み ----

/** 次を始めたら、終えていない前のものはその時刻で自動で終える（2026-11-09） */
export async function startSession(
  input: Pick<StartSession, 'lifeDate' | 'title' | 'planItemId' | 'trackId' | 'quick'>,
  database: ShioriDB = db,
): Promise<StartSession> {
  const at = realNowIso();
  const s: StartSession = { id: newId(), startedAt: at, ...input };
  for (const k of Object.keys(s) as (keyof StartSession)[]) if (s[k] === undefined) delete s[k];
  await database.transaction('rw', database.starts, async () => {
    const open = await database.starts.filter((x) => !x.endedAt).toArray();
    for (const o of open) await database.starts.put({ ...o, endedAt: at > o.startedAt ? at : o.startedAt, outcome: 'auto' });
    await database.starts.add(s);
  });
  return s;
}

/** その場の5分は、押さなくてもこの分数で終える（回数だけ数えるので時間は使わない） */
export const QUICK_AUTO_END_MIN = 30;

/**
 * 押さずに終えるときの時刻（2026-11-09）。
 * 計画の行き先：予定の終わり時刻。終わりを過ぎてから始めたときは、始めてから予定の長さぶん。
 * その場の5分（と、行き先が見つからないもの）：始めてから30分
 */
export function autoEndAt(s: StartSession, plans: Plan[]): string {
  const started = Date.parse(s.startedAt);
  const after = (min: number) => new Date(started + min * 60000).toISOString();
  if (s.quick || !s.planItemId) return after(QUICK_AUTO_END_MIN);
  for (const p of plans) {
    const item = p.items.find((i) => i.id === s.planItemId);
    if (!item) continue;
    if (item.start === undefined) return after(item.minutes);
    const end = lifeMinuteToIso(p.lifeDate, item.start + item.minutes);
    return Date.parse(end) > started ? end : after(item.minutes);
  }
  return after(QUICK_AUTO_END_MIN);
}

/** 終える時刻を過ぎたまま開いている記録を、その時刻で終える。終えた件数を返す */
export async function autoEndSessions(now: string = realNowIso(), database: ShioriDB = db): Promise<number> {
  return database.transaction('rw', database.starts, database.plans, async () => {
    const open = await database.starts.filter((x) => !x.endedAt).toArray();
    if (!open.length) return 0;
    const plans = await database.plans.toArray();
    let n = 0;
    for (const s of open) {
      const at = autoEndAt(s, plans);
      if (at > now) continue;
      await database.starts.put({ ...s, endedAt: at, outcome: 'auto' });
      n++;
    }
    return n;
  });
}

export async function setSessionPush(id: string, pushId: string, database: ShioriDB = db) {
  await database.starts.update(id, { pushId });
}

export async function endSession(
  id: string,
  outcome: 'done' | 'stopped',
  reason?: string,
  database: ShioriDB = db,
): Promise<StartSession | undefined> {
  const s = await database.starts.get(id);
  if (!s || s.endedAt) return s;
  const next: StartSession = { ...s, endedAt: realNowIso(), outcome };
  if (reason?.trim()) next.reason = reason.trim();
  await database.starts.put(next);
  return next;
}

/** 始めたのを取り消す（間違えて押したとき）。記録ごと消す */
export async function discardSession(id: string, database: ShioriDB = db) {
  await database.starts.delete(id);
}

/** ここまでにする：「次はここから」があれば取り組みの前回の続きに残す（次回の最初の一手になる） */
export async function stopSession(id: string, reason: string | undefined, note: string, database: ShioriDB = db) {
  await database.transaction('rw', database.starts, database.tracks, async () => {
    const s = await endSession(id, 'stopped', reason, database);
    const text = note.trim();
    if (!s?.trackId || !text) return;
    const track = await database.tracks.get(s.trackId);
    if (track) await database.tracks.put({ ...track, lastNote: { text, at: nowIso() } });
  });
}
