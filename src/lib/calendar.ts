import { addDays, weekday, weekStartMonday } from './lifeDate';
import { GAP_MINUTES, parseHm } from './schedule';
import { workedMinutes } from './records';
import type { Plan, PlanItem, Routine, StartSession } from './types';

// カレンダーで組む（2026-11-08 決定。要件メモ「カレンダーで組む」）
// 時刻はすべて「その日の 0:00 からの分」。翌日にまたがるときは 1440 以上になる

export const MIN_LEN = 30;
export const SNAP = 15;
export const DEFAULT_VIEW = { start: 6, end: 24, focus: 8 };

export function snap(m: number): number {
  return Math.round(m / SNAP) * SNAP;
}

export function formatMinute(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatDuration(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!h) return `${mm}分`;
  return mm ? `${h}時間${mm}分` : `${h}時間`;
}

/** 開始時刻のない古い計画は、時間帯の開始から「所要時間＋10分」ずつ割り付ける（以前の画面と同じ並び） */
export function withStarts(plan: Plan): PlanItem[] {
  let t = parseHm(plan.window.start);
  return plan.items.map((i) => {
    if (typeof i.start === 'number') {
      t = i.start + i.minutes + GAP_MINUTES;
      return i;
    }
    const s = t;
    t += i.minutes + GAP_MINUTES;
    return { ...i, start: s };
  });
}

/** 開始時刻の順に並べた行き先（これが実行順） */
export function itemsByStart(plan: Plan): (PlanItem & { start: number })[] {
  return (withStarts(plan) as (PlanItem & { start: number })[]).slice().sort((a, b) => a.start - b.start);
}

/** 次の行き先：開始時刻の順で、まだ済でも未でもない最初の1件 */
export function nextItem(plan: Plan): (PlanItem & { start: number }) | undefined {
  return itemsByStart(plan).find((i) => i.status === 'planned');
}

export interface FixedBlock {
  id: string;
  title: string;
  start: number;
  min: number;
  /** いつもの固定から来たもの */
  routineId?: string;
  /** この日だけ時刻を変えている */
  edited?: boolean;
  /** この日だけの予定 */
  extraId?: string;
}

/** その日に適用する曜日（休日扱いなら日曜と同じ） */
export function effectiveWeekday(lifeDate: string, plan?: Plan): number {
  return plan?.holiday ? 0 : weekday(lifeDate);
}

/** その日の固定：いつもの固定（曜日に合うもの）にその日の変更を当て、この日だけの予定を足す */
export function fixedBlocksFor(lifeDate: string, routines: Routine[], plan?: Plan): FixedBlock[] {
  const wd = effectiveWeekday(lifeDate, plan);
  const edits = plan?.fixedEdits ?? {};
  const fromRoutines = routines
    .filter((r) => r.days.includes(wd) && edits[r.id] !== 'removed')
    .map((r) => {
      const e = edits[r.id];
      const moved = e && e !== 'removed' ? e : null;
      return {
        id: `routine:${r.id}`,
        routineId: r.id,
        title: r.title,
        start: moved ? moved.start : r.start,
        min: moved ? moved.min : r.min,
        edited: !!moved,
      };
    });
  const extra = (plan?.extraFixed ?? []).map((x) => ({ id: `extra:${x.id}`, extraId: x.id, title: x.title, start: x.start, min: x.min }));
  return [...fromRoutines, ...extra].sort((a, b) => a.start - b.start);
}

/** 重なった予定を横に並べる：各予定の列番号と、その予定と重なる範囲の列数 */
export function layoutColumns<T extends { id: string; start: number; min: number }>(blocks: T[]): Record<string, { col: number; cols: number }> {
  const sorted = blocks.slice().sort((a, b) => a.start - b.start || b.min - a.min);
  const col: Record<string, number> = {};
  const overlaps = (a: T, b: T) => a.start < b.start + b.min && b.start < a.start + a.min;
  for (const b of sorted) {
    const used = new Set(sorted.filter((o) => o.id !== b.id && col[o.id] !== undefined && overlaps(o, b)).map((o) => col[o.id]));
    let c = 0;
    while (used.has(c)) c++;
    col[b.id] = c;
  }
  const out: Record<string, { col: number; cols: number }> = {};
  for (const b of sorted) {
    let n = col[b.id] + 1;
    for (const o of sorted) if (overlaps(o, b)) n = Math.max(n, col[o.id] + 1);
    out[b.id] = { col: col[b.id], cols: n };
  }
  return out;
}

export interface Gap {
  start: number;
  len: number;
}

/**
 * 空き：予定（固定も含む）のあいだで minLen 分以上空いているところ。
 * from を渡すとそこから最初の予定まで、to を渡すと最後の予定からそこまでも数える（予定がなければ from〜to 全体）
 */
export function findGaps(blocks: { start: number; min: number }[], options: { minLen?: number; from?: number; to?: number } = {}): Gap[] {
  const minLen = options.minLen ?? MIN_LEN;
  const sorted = blocks.slice().sort((a, b) => a.start - b.start);
  const gaps: Gap[] = [];
  let cursor: number | null = options.from ?? null;
  const push = (s: number, e: number) => {
    if (e - s >= minLen) gaps.push({ start: s, len: e - s });
  };
  for (const b of sorted) {
    if (cursor !== null) push(cursor, b.start);
    cursor = cursor === null ? b.start + b.min : Math.max(cursor, b.start + b.min);
  }
  if (options.to !== undefined && cursor !== null) push(cursor, options.to);
  return gaps;
}

/** 今週（月曜はじまり）に済をつけた時間を、取り組みごとに合計する */
export function weeklyDoneMinutes(plans: Plan[], today: string, sessions: StartSession[] = []): Record<string, number> {
  const monday = weekStartMonday(today);
  const sunday = addDays(monday, 6);
  const out: Record<string, number> = {};
  for (const p of plans) {
    if (p.lifeDate < monday || p.lifeDate > sunday) continue;
    const day = sessions.filter((s) => s.lifeDate === p.lifeDate);
    for (const [trackId, min] of Object.entries(workedMinutes(p, day))) out[trackId] = (out[trackId] ?? 0) + min;
  }
  return out;
}

/** 新しく置く行き先の開始時刻：指定の時刻を15分に合わせ、表示範囲に収める */
export function placeStart(at: number, minutes: number, view: { start: number; end: number }): number {
  return Math.max(view.start * 60, Math.min(view.end * 60 - minutes, snap(at)));
}
