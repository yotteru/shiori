import { toDate } from './clock';
import { addDays, diffDays, lifeDate } from './lifeDate';
import type { Plan, Track } from './types';

// 止まっている取り組み（§3.5）：最後の済から7日以上。済が一度もなければ作成日から数える
export const STALLED_DAYS = 7;

export function daysSinceTouched(track: Track, lastDoneAt: string | undefined, today: string): number {
  const base = lastDoneAt ?? track.createdAt;
  return diffDays(lifeDate(toDate(base)), today);
}

export function isStalled(track: Track, lastDoneAt: string | undefined, today: string): boolean {
  return daysSinceTouched(track, lastDoneAt, today) >= STALLED_DAYS;
}

/** 習慣型の直近 n 日（古い順）に済があったか */
export function recentHabitDays(trackId: string, plans: Plan[], today: string, n = 14): { date: string; done: boolean }[] {
  const doneDates = new Set(
    plans.filter((p) => p.items.some((i) => i.trackId === trackId && i.status === 'done')).map((p) => p.lifeDate),
  );
  return Array.from({ length: n }, (_, k) => {
    const date = addDays(today, k - n + 1);
    return { date, done: doneDates.has(date) };
  });
}
