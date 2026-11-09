import { fixedBlocksFor } from './calendar';
import { addDays, weekday, weekStartMonday } from './lifeDate';
import type { Plan, Routine, StartSession } from './types';

// 週の見通しと振り返り（2026-11-09。要件メモ「週の見通しと振り返り」）。
// 週は月〜日。見通しは「決まっている予定」と「この日にやることの札」だけで、時刻つきの行き先は前の晩に置く

/** その週の月〜日（offset 0 = today を含む週） */
export function weekDates(today: string, offset = 0): string[] {
  const monday = addDays(weekStartMonday(today), offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 開いたときの週：日曜の夕方（17時）以降は来週を見せる。それ以外は今週 */
export function defaultWeekOffset(today: string, hourJst: number): number {
  return weekday(today) === 0 && hourJst >= 17 ? 1 : 0;
}

/** 休日か：土日、または「休日として扱う」にした日 */
export function isHoliday(date: string, plan?: Plan): boolean {
  const wd = weekday(date);
  return wd === 0 || wd === 6 || !!plan?.holiday;
}

/** 終日の予定 */
export function allDayEvents(plan?: Plan) {
  return (plan?.extraFixed ?? []).filter((x) => x.allDay);
}

/** 表示する時間帯（時）の中で、決まっている予定（いつもの固定・その日だけの予定）が入っていない時間（分）。終日の予定があれば 0 */
export function freeMinutes(date: string, routines: Routine[], plan: Plan | undefined, view: { start: number; end: number }): number {
  if (allDayEvents(plan).length) return 0;
  const from = view.start * 60;
  const to = view.end * 60;
  const segs = fixedBlocksFor(date, routines, plan)
    .map((b) => [Math.max(b.start, from), Math.min(b.start + b.min, to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of segs) {
    if (!cur || s > cur[1]) {
      if (cur) busy += cur[1] - cur[0];
      cur = [s, e];
    } else cur[1] = Math.max(cur[1], e);
  }
  if (cur) busy += cur[1] - cur[0];
  return to - from - busy;
}

/** 取り組みごとに、札を付けた日（週の7日ぶん） */
export function allocation(plans: Plan[], dates: string[]): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  dates.forEach((d, i) => {
    const p = plans.find((x) => x.lifeDate === d);
    for (const id of p?.intents ?? []) (out[id] ??= Array(7).fill(false))[i] = true;
  });
  return out;
}

export type Square = 'full' | 'half' | 'plan' | 'none';

/**
 * 振り返りの7マス：済＝full、始めた（ここまで・始めたまま）＝half、置いたけど手つかず＝plan、なし＝none。
 * その場の5分は取り組みに入れない
 */
export function weekSquares(plans: Plan[], sessions: StartSession[], dates: string[]): Record<string, Square[]> {
  const out: Record<string, Square[]> = {};
  const rank: Record<Square, number> = { none: 0, plan: 1, half: 2, full: 3 };
  const bump = (trackId: string, i: number, s: Square) => {
    const row = (out[trackId] ??= Array(7).fill('none'));
    if (rank[s] > rank[row[i]]) row[i] = s;
  };
  dates.forEach((d, i) => {
    const p = plans.find((x) => x.lifeDate === d);
    for (const it of p?.items ?? []) bump(it.trackId, i, it.status === 'done' ? 'full' : 'plan');
    for (const s of sessions) if (s.lifeDate === d && s.trackId && !s.quick) bump(s.trackId, i, s.outcome === 'done' ? 'full' : 'half');
  });
  return out;
}

export function quickCount(sessions: StartSession[], dates: string[]): number {
  return sessions.filter((s) => s.quick && dates.includes(s.lifeDate)).length;
}
