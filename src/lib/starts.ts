import { nowIso, realNowIso } from './clock';
import { db, type ShioriDB } from './db';
import { newId } from './id';
import type { StartSession } from './types';

// 始めた記録（2026-11-08「5分だけで始める」の見直し。要件メモ「始める瞬間の綱引きへの対策」）。
// 画面のタイマーは置かない。始めた時刻を残し、終えたとき（済・ここまで）に実際の時間が決まる

/** 「ここまで」の理由の候補（設定で変えられる） */
export const DEFAULT_STOP_REASONS = ['疲れた', '時間切れ', '気が乗らない', '割り込み', 'キリがいい'];

// ---- 書き込み ----

export async function startSession(
  input: Pick<StartSession, 'lifeDate' | 'title' | 'planItemId' | 'trackId' | 'quick'>,
  database: ShioriDB = db,
): Promise<StartSession> {
  const s: StartSession = { id: newId(), startedAt: realNowIso(), ...input };
  for (const k of Object.keys(s) as (keyof StartSession)[]) if (s[k] === undefined) delete s[k];
  await database.starts.add(s);
  return s;
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
