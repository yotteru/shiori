import { fixedBlocksFor } from './calendar';
import { addDays } from './lifeDate';
import type { Plan, Routine } from './types';

// いつもの固定の記録（2026-11-10。要件メモ「いつもの固定の記録」）。
// 記録する固定は「置いたとおりにやった」とみなし、その日の時刻と長さ（ドラッグで直したもの）を残す。
// その日だけ外したら「なし」。数えるのは過ぎた分だけ（今日は終わった時刻を過ぎたもの）

export interface RoutineDay {
  routineId: string;
  trackId?: string;
  date: string;
  start: number;
  min: number;
}

export const isRecorded = (r: Routine) => !!(r.record || r.trackId);

/** from〜to（生活日）のうち、記録する固定の、過ぎた日ごとの時刻と長さ */
export function recordedRoutineDays(routines: Routine[], plans: Plan[], from: string, to: string, today: string, nowMin: number): RoutineDay[] {
  const out: RoutineDay[] = [];
  const recorded = routines.filter(isRecorded);
  if (!recorded.length) return out;
  const last = to < today ? to : today;
  for (let d = from; d <= last; d = addDays(d, 1)) {
    const plan = plans.find((p) => p.lifeDate === d);
    for (const r of recorded) {
      if (r.recordFrom && d < r.recordFrom) continue;
      const b = fixedBlocksFor(d, [r], plan).find((x) => x.routineId === r.id);
      if (!b) continue;
      if (d === today && b.start + b.min > nowMin) continue;
      out.push({ routineId: r.id, trackId: r.trackId, date: d, start: b.start, min: b.min });
    }
  }
  return out;
}

/** つないだ取り組みごと・日ごとの分 */
export function routineMinutesByTrack(days: RoutineDay[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const x of days) {
    if (!x.trackId) continue;
    const row = (out[x.trackId] ??= {});
    row[x.date] = (row[x.date] ?? 0) + x.min;
  }
  return out;
}
