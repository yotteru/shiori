import { addDays, weekStartMonday } from './lifeDate';
import type { Plan, StartSession } from './types';

// 記録タブ（2026-11-08）：やった時間と始めた回数を週ごとに数える（月曜はじまり。置いただけの予定は数えない）

export interface WeeklyHistory {
  /** 各週の月曜日（古い順。最後が今週） */
  weeks: string[];
  /** 取り組みごとの、各週の済の時間（分） */
  byTrack: Record<string, number[]>;
}

export function weeklyHistory(plans: Plan[], today: string, count = 8, sessions: StartSession[] = []): WeeklyHistory {
  const thisMonday = weekStartMonday(today);
  const weeks = Array.from({ length: count }, (_, i) => addDays(thisMonday, -7 * (count - 1 - i)));
  const byTrack: Record<string, number[]> = {};
  for (const p of plans) {
    const idx = weeks.indexOf(weekStartMonday(p.lifeDate));
    if (idx < 0) continue;
    const day = sessions.filter((s) => s.lifeDate === p.lifeDate);
    for (const [trackId, min] of Object.entries(workedMinutes(p, day))) {
      (byTrack[trackId] ??= Array(count).fill(0))[idx] += min;
    }
  }
  return { weeks, byTrack };
}

/** 1回で数える時間の上限（終えるのを忘れて翌日に閉じた、などで記録が膨らまないように） */
export const MAX_SESSION_MIN = 180;

export function sessionMinutes(s: StartSession): number {
  if (!s.endedAt) return 0;
  const min = Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000);
  return Math.max(0, Math.min(MAX_SESSION_MIN, min));
}

/** まだ終えていない記録（いちばん新しいもの） */
export function activeSession(sessions: StartSession[]): StartSession | undefined {
  return sessions
    .filter((s) => !s.endedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/**
 * 1日の計画で、取り組みごとにやった時間（分）。
 * 始めた記録があれば実際の時間（済・ここまでの両方）、なければ済をつけた行き先の予定の長さ。
 * その場の5分は数えない
 */
export function workedMinutes(plan: Plan, sessions: StartSession[]): Record<string, number> {
  const out: Record<string, number> = {};
  const byItem = new Map<string, StartSession[]>();
  for (const s of sessions) {
    if (s.quick || !s.planItemId) continue;
    const list = byItem.get(s.planItemId) ?? [];
    list.push(s);
    byItem.set(s.planItemId, list);
  }
  for (const i of plan.items) {
    const ss = (byItem.get(i.id) ?? []).filter((s) => s.endedAt);
    const min = ss.length ? ss.reduce((a, s) => a + sessionMinutes(s), 0) : i.status === 'done' ? i.minutes : 0;
    if (min > 0) out[i.trackId] = (out[i.trackId] ?? 0) + min;
  }
  return out;
}

export interface WeeklyStarts {
  /** 取り組みごとの、各週の始めた回数 */
  byTrack: Record<string, number[]>;
  /** その場の5分の、各週の回数 */
  quick: number[];
}

/** 週ごと（月曜はじまり）の始めた回数。weeks は weeklyHistory と同じ並び */
export function weeklyStarts(sessions: StartSession[], weeks: string[]): WeeklyStarts {
  const byTrack: Record<string, number[]> = {};
  const quick = Array(weeks.length).fill(0);
  for (const s of sessions) {
    const idx = weeks.indexOf(weekStartMonday(s.lifeDate));
    if (idx < 0) continue;
    if (s.quick || !s.trackId) quick[idx]++;
    else (byTrack[s.trackId] ??= Array(weeks.length).fill(0))[idx]++;
  }
  return { byTrack, quick };
}

/** 今週（月〜日）の記録だけ */
export function inWeek(sessions: StartSession[], today: string): StartSession[] {
  const monday = weekStartMonday(today);
  const sunday = addDays(monday, 6);
  return sessions.filter((s) => s.lifeDate >= monday && s.lifeDate <= sunday);
}

