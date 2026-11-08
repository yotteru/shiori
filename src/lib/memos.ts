import { createTrack, type NewStep } from './actions';
import { nowIso } from './clock';
import { db, type ShioriDB } from './db';
import { newId } from './id';
import type { Memo, Track } from './types';

// メモ箱（2026-11-08。要件メモ「メモ箱」、画面案 3-C）。
// 1行で放り込むだけ。候補には出ない。整えると取り組みになり、メモには「取り組みに」の印が残る

export const MEMO_MAX_LENGTH = 200;

export async function addMemo(text: string, database: ShioriDB = db): Promise<Memo | undefined> {
  const t = text.trim().slice(0, MEMO_MAX_LENGTH);
  if (!t) return undefined;
  const m: Memo = { id: newId(), text: t, createdAt: nowIso() };
  await database.memos.add(m);
  return m;
}

export async function deleteMemo(id: string, database: ShioriDB = db) {
  await database.memos.delete(id);
}

/** 整える：メモから取り組みを作り、メモに印をつける */
export async function shapeMemo(
  memoId: string,
  input: Pick<Track, 'name' | 'type' | 'defaultMinutes' | 'defaultFirstStep' | 'defaultCue'> & { goal?: string },
  steps: NewStep[],
  database: ShioriDB = db,
): Promise<Track> {
  const { goal, ...rest } = input;
  const g = goal?.trim();
  const track = await createTrack(g ? { ...rest, goal: g } : rest, steps, database);
  const m = await database.memos.get(memoId);
  if (m) await database.memos.put({ ...m, trackId: track.id, madeAt: nowIso() });
  return track;
}

/** 新しい順。取り組みにしたものは後ろ */
export function sortMemos(memos: Memo[]): Memo[] {
  return memos.slice().sort((a, b) => Number(!!a.trackId) - Number(!!b.trackId) || b.createdAt.localeCompare(a.createdAt));
}
