import { describe, expect, it } from 'vitest';
import { weeklyHistory } from './records';
import type { Plan, PlanItem } from './types';

const plan = (lifeDate: string, items: Partial<PlanItem>[]): Plan => ({
  lifeDate, window: { start: '19:00', end: '22:00' }, createdAt: '', source: 'night',
  items: items.map((x, i) => ({ id: `${lifeDate}-${i}`, trackId: 'gym', title: '', minutes: 60, firstStep: '', status: 'done', ...x })),
});

describe('記録：週ごとの済の時間', () => {
  it('月曜はじまりで直近の週に分け、済だけを数える', () => {
    const h = weeklyHistory(
      [
        plan('2026-11-09', [{ minutes: 90 }, { minutes: 30, status: 'planned' }]), // 今週（月）
        plan('2026-11-08', [{ minutes: 60 }]), // 先週（日）
        plan('2026-11-02', [{ minutes: 45, trackId: 'eng' }]), // 先週（月）
        plan('2026-09-01', [{ minutes: 999 }]), // 範囲外
      ],
      '2026-11-11',
      3,
    );
    expect(h.weeks).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(h.byTrack).toEqual({ gym: [0, 60, 90], eng: [0, 45, 0] });
  });
});
