import { describe, expect, it } from 'vitest';
import { recordedRoutineDays, routineMinutesByTrack } from './routineRecords';
import type { Plan, Routine } from './types';

const sleep: Routine = { id: 'sleep', title: '睡眠', start: 23 * 60, min: 8 * 60, days: [0, 1, 2, 3, 4, 5, 6], record: true, recordFrom: '2026-11-07', createdAt: '' };
const gym: Routine = { id: 'gym', title: '筋トレ', start: 19 * 60, min: 60, days: [1, 3, 5], trackId: 'g', createdAt: '' };
const off: Routine = { id: 'work', title: '仕事', start: 540, min: 540, days: [1, 2, 3, 4, 5], createdAt: '' };
const plan = (lifeDate: string, extra: Partial<Plan>): Plan => ({ lifeDate, window: { start: '19:00', end: '22:00' }, createdAt: '', source: 'night', items: [], ...extra });

describe('いつもの固定の記録（2026-11-10）', () => {
  it('記録する固定だけ。記録を始めた日から、過ぎた分だけ。外した日はなし、動かした日はその時刻', () => {
    const plans = [plan('2026-11-08', { fixedEdits: { sleep: { start: 24 * 60 + 30, min: 7 * 60 } } }), plan('2026-11-09', { fixedEdits: { gym: 'removed' } })];
    const days = recordedRoutineDays([sleep, gym, off], plans, '2026-11-06', '2026-11-10', '2026-11-10', 20 * 60);
    expect(days.map((d) => `${d.routineId}@${d.date}:${d.start}/${d.min}`)).toEqual([
      'sleep@2026-11-07:1380/480',
      'sleep@2026-11-08:1470/420',
      'gym@2026-11-06:1140/60',
      'sleep@2026-11-09:1380/480',
    ].sort((a, b) => a.split('@')[1].localeCompare(b.split('@')[1])));
  });

  it('つないだ取り組みの、日ごとの分', () => {
    const days = recordedRoutineDays([gym], [], '2026-11-02', '2026-11-08', '2026-11-10', 0);
    expect(routineMinutesByTrack(days)).toEqual({ g: { '2026-11-02': 60, '2026-11-04': 60, '2026-11-06': 60 } });
  });
});
