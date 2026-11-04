import { describe, expect, it } from 'vitest';
import { daysSinceTouched, isStalled, recentHabitDays } from './tracks';
import type { Track } from './types';

const t: Track = { id: 'h', name: 'x', type: 'habit', createdAt: '2026-10-20T03:00:00Z' };

describe('止まっている取り組み', () => {
  it('最後の済から7生活日以上で止まっている扱い', () => {
    expect(daysSinceTouched(t, '2026-10-28T12:00:00Z', '2026-11-04')).toBe(7);
    expect(isStalled(t, '2026-10-28T12:00:00Z', '2026-11-04')).toBe(true);
    expect(isStalled(t, '2026-10-29T12:00:00Z', '2026-11-04')).toBe(false);
  });
  it('済が一度もなければ作成日から数える', () => {
    expect(daysSinceTouched(t, undefined, '2026-11-04')).toBe(15);
  });
  it('直近の実施マス', () => {
    const days = recentHabitDays('h', [
      { lifeDate: '2026-11-03', window: { start: '19:00', end: '22:00' }, createdAt: '', source: 'night', items: [{ id: 'i', trackId: 'h', title: '', minutes: 1, firstStep: '', status: 'done' }] },
    ], '2026-11-04', 3);
    expect(days).toEqual([
      { date: '2026-11-02', done: false },
      { date: '2026-11-03', done: true },
      { date: '2026-11-04', done: false },
    ]);
  });
});
