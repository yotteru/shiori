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

// ---- 同じ名前の固定（時間帯を分けた固定。2026-11-10） ----

/** 設定の一覧の並び：同じ名前を続けて並べる（名前ごとに最初の時間帯の早い順、その中は時刻順） */
export function sortRoutinesGrouped(routines: Routine[]): Routine[] {
  const first = new Map<string, number>();
  for (const r of routines) first.set(r.title, Math.min(first.get(r.title) ?? Infinity, r.start));
  return routines.slice().sort((a, b) => first.get(a.title)! - first.get(b.title)! || a.title.localeCompare(b.title) || a.start - b.start);
}

/** 時間帯を足すときの新しい固定：名前・曜日・記録の設定を写し、今の終わりの時刻から1時間 */
export function nextSlotOf(r: Routine): Omit<Routine, 'id' | 'createdAt' | 'updatedAt'> {
  const out: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'> = { title: r.title, start: (r.start + r.min) % (24 * 60), min: 60, days: [...r.days] };
  if (r.record) out.record = true;
  if (r.recordFrom) out.recordFrom = r.recordFrom;
  if (r.trackId) out.trackId = r.trackId;
  return out;
}

/** 記録を名前ごと・日ごとにまとめる（1日の合計と、その日の最初の時間帯の始まり） */
export function groupRoutineDaysByTitle(days: RoutineDay[], routines: Routine[]): Map<string, Map<string, { min: number; start: number }>> {
  const titleOf = new Map(routines.map((r) => [r.id, r.title]));
  const out = new Map<string, Map<string, { min: number; start: number }>>();
  for (const d of days) {
    const t = titleOf.get(d.routineId);
    if (!t) continue;
    const byDate = out.get(t) ?? new Map<string, { min: number; start: number }>();
    const cur = byDate.get(d.date);
    byDate.set(d.date, cur ? { min: cur.min + d.min, start: Math.min(cur.start, d.start) } : { min: d.min, start: d.start });
    out.set(t, byDate);
  }
  return out;
}
