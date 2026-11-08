import { describe, expect, it } from 'vitest';
import { activeSession, sessionMinutes, weeklyHistory, weeklyStarts, workedMinutes } from './records';
import type { Plan, PlanItem, StartSession } from './types';

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

const ses = (x: Partial<StartSession>): StartSession => ({
  id: Math.random().toString(36).slice(2), lifeDate: '2026-11-09', startedAt: '2026-11-09T10:00:00Z', title: '', ...x,
});

describe('始めた記録：実際の時間と回数', () => {
  it('実際の時間は始めてから終えるまで。終えていなければ0、上限は180分', () => {
    expect(sessionMinutes(ses({ endedAt: '2026-11-09T10:07:30Z' }))).toBe(8);
    expect(sessionMinutes(ses({}))).toBe(0);
    expect(sessionMinutes(ses({ endedAt: '2026-11-10T10:00:00Z' }))).toBe(180);
  });

  it('始めた行き先は実際の時間（ここまでも含む）、始めずに済にした行き先は予定の長さ。その場の5分は数えない', () => {
    const p = plan('2026-11-09', [
      { id: 'a', minutes: 60 }, // 5分でここまで → 実際の5分
      { id: 'b', minutes: 30, trackId: 'eng' }, // 始めずに済 → 30分
      { id: 'c', minutes: 60, status: 'planned' }, // 置いただけ → 0
    ]);
    const w = workedMinutes(p, [
      ses({ planItemId: 'a', trackId: 'gym', endedAt: '2026-11-09T10:05:00Z', outcome: 'stopped' }),
      ses({ quick: true, endedAt: '2026-11-09T11:00:00Z' }),
    ]);
    expect(w).toEqual({ gym: 5, eng: 30 });
    const h = weeklyHistory([p], '2026-11-11', 1, [ses({ planItemId: 'a', trackId: 'gym', endedAt: '2026-11-09T10:05:00Z' })]);
    expect(h.byTrack).toEqual({ gym: [5], eng: [30] });
  });

  it('回数は取り組みごとと、その場の5分に分けて週ごとに数える', () => {
    const r = weeklyStarts(
      [ses({ trackId: 'gym' }), ses({ trackId: 'gym', lifeDate: '2026-11-03' }), ses({ quick: true }), ses({ trackId: 'gym', lifeDate: '2026-01-01' })],
      ['2026-11-02', '2026-11-09'],
    );
    expect(r).toEqual({ byTrack: { gym: [1, 1] }, quick: [0, 1] });
  });

  it('まだ終えていない記録のうち新しいもの', () => {
    const a = ses({ id: 'old', startedAt: '2026-11-09T09:00:00Z' });
    const b = ses({ id: 'new', startedAt: '2026-11-09T10:00:00Z' });
    expect(activeSession([a, b, ses({ startedAt: '2026-11-09T11:00:00Z', endedAt: '2026-11-09T11:10:00Z' })])?.id).toBe('new');
  });
});
