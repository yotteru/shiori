import { describe, expect, it } from 'vitest';
import { findGaps, fixedBlocksFor, formatDuration, itemsByStart, layoutColumns, nextItem, placeStart, weeklyDoneMinutes, withStarts } from './calendar';
import type { Plan, PlanItem, Routine } from './types';

const item = (id: string, minutes: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id, trackId: `t-${id}`, title: id, minutes, firstStep: '', status: 'planned', ...extra,
});
const plan = (lifeDate: string, items: PlanItem[], extra: Partial<Plan> = {}): Plan => ({
  lifeDate, window: { start: '19:00', end: '22:30' }, createdAt: '', source: 'night', items, ...extra,
});

const routines: Routine[] = [
  { id: 'work', title: '仕事', start: 540, min: 540, days: [1, 2, 3, 4, 5], createdAt: '' },
  { id: 'dinner', title: '夕食', start: 1110, min: 60, days: [0, 1, 2, 3, 4, 5, 6], createdAt: '' },
];

describe('開始時刻', () => {
  it('開始時刻のない古い計画は、以前の画面と同じく時間帯の開始から割り付ける', () => {
    const p = plan('2026-11-09', [item('a', 90), item('b', 45)]);
    expect(withStarts(p).map((i) => i.start)).toEqual([1140, 1240]);
  });
  it('実行順は開始時刻の順。次の行き先は予定のままの最初の1件', () => {
    const p = plan('2026-11-09', [item('late', 30, { start: 1260 }), item('early', 30, { start: 1170, status: 'done' }), item('mid', 30, { start: 1200 })]);
    expect(itemsByStart(p).map((i) => i.id)).toEqual(['early', 'mid', 'late']);
    expect(nextItem(p)?.id).toBe('mid');
  });
  it('置く時刻は15分に合わせ、表示範囲に収める', () => {
    expect(placeStart(1187, 30, { start: 6, end: 24 })).toBe(1185);
    expect(placeStart(1430, 60, { start: 6, end: 24 })).toBe(1380);
    expect(placeStart(100, 30, { start: 6, end: 24 })).toBe(360);
  });
});

describe('いつもの固定', () => {
  it('曜日に合うものだけ置かれる（11/9 は月曜、11/8 は日曜）', () => {
    expect(fixedBlocksFor('2026-11-09', routines).map((b) => b.title)).toEqual(['仕事', '夕食']);
    expect(fixedBlocksFor('2026-11-08', routines).map((b) => b.title)).toEqual(['夕食']);
  });
  it('その日だけの変更（動かした・外した）と、この日だけの予定が反映される', () => {
    const p = plan('2026-11-09', [], {
      fixedEdits: { dinner: { start: 1140, min: 45 }, work: 'removed' },
      extraFixed: [{ id: 'x', title: '歯医者', start: 600, min: 60 }],
    });
    expect(fixedBlocksFor('2026-11-09', routines, p).map((b) => [b.title, b.start, b.min, !!b.edited])).toEqual([
      ['歯医者', 600, 60, false],
      ['夕食', 1140, 45, true],
    ]);
  });
  it('休日として扱うと、日曜と同じ固定になる', () => {
    expect(fixedBlocksFor('2026-11-09', routines, plan('2026-11-09', [], { holiday: true })).map((b) => b.title)).toEqual(['夕食']);
  });
  it('いつもの固定を変えると、その日に変えていない日はすべて新しい時刻になる', () => {
    const changed = routines.map((r) => (r.id === 'dinner' ? { ...r, start: 1140 } : r));
    expect(fixedBlocksFor('2026-11-10', changed).find((b) => b.routineId === 'dinner')?.start).toBe(1140);
  });
});

describe('カレンダーの計算', () => {
  it('重なった予定は横に並べる', () => {
    const l = layoutColumns([
      { id: 'a', start: 1170, min: 90 },
      { id: 'b', start: 1200, min: 30 },
      { id: 'c', start: 1290, min: 30 },
    ]);
    expect(l).toEqual({ a: { col: 0, cols: 2 }, b: { col: 1, cols: 2 }, c: { col: 0, cols: 1 } });
  });
  it('空きは30分以上だけ。from より前は数えない', () => {
    const blocks = [{ start: 1110, min: 60 }, { start: 1185, min: 30 }, { start: 1260, min: 45 }];
    expect(findGaps(blocks)).toEqual([{ start: 1215, len: 45 }]);
    expect(findGaps(blocks, { from: 1230 })).toEqual([{ start: 1230, len: 30 }]);
    expect(findGaps(blocks, { from: 1240 })).toEqual([]);
  });
  it('今週（月曜はじまり）に済をつけた時間を取り組みごとに合計する', () => {
    const plans = [
      plan('2026-11-08', [item('a', 90, { status: 'done', trackId: 'gym' })]), // 日曜＝前の週
      plan('2026-11-09', [item('b', 90, { status: 'done', trackId: 'gym' }), item('c', 30, { trackId: 'eng' })]),
      plan('2026-11-11', [item('d', 30, { status: 'done', trackId: 'eng' })]),
    ];
    expect(weeklyDoneMinutes(plans, '2026-11-11')).toEqual({ gym: 90, eng: 30 });
  });
  it('長さの表示', () => {
    expect([formatDuration(30), formatDuration(60), formatDuration(105)]).toEqual(['30分', '1時間', '1時間45分']);
  });
});
