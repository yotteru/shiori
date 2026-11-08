import { describe, expect, it } from 'vitest';
import { buildStartReminders, DEFAULT_START_REMINDER, reminderBody, startInstant } from './startReminders';
import type { Plan, PlanItem, StartSession } from './types';

const plan = (lifeDate: string, items: Partial<PlanItem>[]): Plan => ({
  lifeDate,
  window: { start: '19:00', end: '22:00' },
  createdAt: '',
  source: 'night',
  items: items.map((x, i) => ({ id: `${lifeDate}-${i}`, trackId: 't', title: `行き先${i}`, minutes: 60, firstStep: '', status: 'planned', ...x })),
});

const on = { ...DEFAULT_START_REMINDER, enabled: true };
const now = Date.parse('2026-11-09T12:00:00+09:00');

describe('開始時刻の通知', () => {
  it('生活日と分から JST の時刻を出す（日付をまたぐ 24時以降も）', () => {
    expect(new Date(startInstant('2026-11-09', 10 * 60)).toISOString()).toBe('2026-11-09T01:00:00.000Z');
    expect(new Date(startInstant('2026-11-09', 25 * 60)).toISOString()).toBe('2026-11-09T16:00:00.000Z');
  });

  it('文面の {行き先} を名前に置きかえる。空なら決まった文面', () => {
    expect(reminderBody('{行き先} の時間です', 'ジム')).toBe('ジム の時間です');
    expect(reminderBody('  ', 'ジム')).toBe('次の行き先の時間です');
  });

  it('今日と明日の、まだの行き先だけ。過ぎた時刻・済・始めている行き先は除く。○分前に送る', () => {
    const plans = [
      plan('2026-11-09', [
        { id: 'past', start: 11 * 60 },
        { id: 'a', start: 13 * 60 },
        { id: 'done', start: 14 * 60, status: 'done' },
        { id: 'act', start: 15 * 60 },
      ]),
      plan('2026-11-10', [{ id: 'b', start: 9 * 60 }]),
      plan('2026-11-11', [{ id: 'far', start: 9 * 60 }]),
    ];
    const sessions: StartSession[] = [{ id: 's', lifeDate: '2026-11-09', startedAt: '2026-11-09T02:00:00Z', title: '', planItemId: 'act' }];
    const r = buildStartReminders(plans, '2026-11-09', { ...on, leadMinutes: 5 }, sessions, now);
    expect(r.map((x) => x.send_at)).toEqual(['2026-11-09T03:55:00.000Z', '2026-11-09T23:55:00.000Z']);
  });

  it('「最初の行き先だけ」はその日の最初の1件。オフなら何も送らない', () => {
    const plans = [plan('2026-11-09', [{ id: 'x', start: 18 * 60 }, { id: 'y', start: 13 * 60 }])];
    expect(buildStartReminders(plans, '2026-11-09', { ...on, target: 'first' }, [], now)).toHaveLength(1);
    expect(buildStartReminders(plans, '2026-11-09', { ...on, target: 'first' }, [], now)[0].send_at).toBe('2026-11-09T04:00:00.000Z');
    expect(buildStartReminders(plans, '2026-11-09', DEFAULT_START_REMINDER, [], now)).toEqual([]);
  });
});
