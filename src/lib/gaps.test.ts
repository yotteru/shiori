import { describe, expect, it } from 'vitest';
import { gapBreakdown, labelByHour, labelOf, pastGaps, weeklyGapBreakdown, withGapLabel } from './gaps';
import type { Plan, Routine } from './types';

const routines: Routine[] = [{ id: 'work', title: '仕事', start: 540, min: 540, days: [1, 2, 3, 4, 5], createdAt: '' }];
const view = { start: 6, end: 24 };
const plan = (lifeDate: string, extra: Partial<Plan> = {}): Plan => ({
  lifeDate,
  window: { start: '19:00', end: '22:00' },
  createdAt: '',
  source: 'night',
  items: [{ id: 'a', trackId: 't', title: '英語', minutes: 60, firstStep: '', status: 'planned', start: 20 * 60 }],
  ...extra,
});

describe('空いていた時間（2026-11-10）', () => {
  it('過ぎた空きだけ。今日はいままで（15分単位）', () => {
    const g = pastGaps('2026-11-09', routines, plan('2026-11-09'), view, 21 * 60 + 40);
    expect(g).toEqual([
      { start: 360, len: 180 },
      { start: 1080, len: 120 },
      { start: 1260, len: 30 },
    ]);
  });

  it('いまより後の予定のあいだの空きは入れない', () => {
    const p = plan('2026-11-09', {
      items: [
        { id: 'a', trackId: 't', title: '英語', minutes: 30, firstStep: '', status: 'planned', start: 20 * 60 },
        { id: 'b', trackId: 't', title: 'ジム', minutes: 60, firstStep: '', status: 'planned', start: 21 * 60 },
      ],
    });
    expect(pastGaps('2026-11-09', routines, p, view, 19 * 60 + 40)).toEqual([
      { start: 360, len: 180 },
      { start: 1080, len: 90 },
    ]);
  });

  it('印を付ける・置き換える・外す。内訳は今の空きと重なる部分だけ', () => {
    const gaps = pastGaps('2026-11-09', routines, plan('2026-11-09'), view);
    let labels = withGapLabel([], gaps[1], 'phone');
    labels = withGapLabel(labels, gaps[1], 'rest');
    expect(labels).toEqual([{ start: 1080, min: 120, label: 'rest' }]);
    expect(labelOf(gaps[1], labels)).toBe('rest');
    labels = withGapLabel(labels, gaps[0], 'phone');
    const b = gapBreakdown(gaps, labels);
    expect(b.total).toBe(180 + 120 + 180);
    expect(b.byLabel).toEqual({ rest: 120, phone: 180, errand: 0 });
    expect(b.none).toBe(180);
    expect(withGapLabel(labels, gaps[0], undefined)).toEqual([{ start: 1080, min: 120, label: 'rest' }]);
  });

  it('週ごとの内訳は計画のある日だけ。時間帯ごとの合計', () => {
    const plans = [plan('2026-11-09', { gapLabels: [{ start: 1290, min: 90, label: 'phone' }] }), plan('2026-11-02')];
    const w = weeklyGapBreakdown(plans, routines, view, '2026-11-10', 8 * 60, 2);
    expect(w.map((x) => x.monday)).toEqual(['2026-11-02', '2026-11-09']);
    expect(w[1].b.byLabel.phone).toBe(90);
    expect(labelByHour(plans, 'phone', '2026-11-10')).toEqual({ 21: 30, 22: 60 });
  });
});
