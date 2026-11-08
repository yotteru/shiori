import { addDays, weekStartMonday } from './lifeDate';
import type { Plan } from './types';

// 記録タブ（2026-11-08）：済をつけた時間を週ごとに数える（月曜はじまり。置いただけの予定は数えない）

export interface WeeklyHistory {
  /** 各週の月曜日（古い順。最後が今週） */
  weeks: string[];
  /** 取り組みごとの、各週の済の時間（分） */
  byTrack: Record<string, number[]>;
}

export function weeklyHistory(plans: Plan[], today: string, count = 8): WeeklyHistory {
  const thisMonday = weekStartMonday(today);
  const weeks = Array.from({ length: count }, (_, i) => addDays(thisMonday, -7 * (count - 1 - i)));
  const byTrack: Record<string, number[]> = {};
  for (const p of plans) {
    const idx = weeks.indexOf(weekStartMonday(p.lifeDate));
    if (idx < 0) continue;
    for (const i of p.items) {
      if (i.status !== 'done') continue;
      (byTrack[i.trackId] ??= Array(count).fill(0))[idx] += i.minutes;
    }
  }
  return { weeks, byTrack };
}
