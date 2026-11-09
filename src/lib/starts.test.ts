import { describe, expect, it } from 'vitest';
import { ShioriDB } from './db';
import { lifeMinuteToIso } from './lifeDate';
import { autoEndAt, autoEndSessions, startSession } from './starts';
import type { Plan, StartSession } from './types';

let n = 0;
const fresh = () => new ShioriDB(`starts-${n++}`);

const plan: Plan = {
  lifeDate: '2026-11-09',
  window: { start: '19:00', end: '22:30' },
  source: 'night',
  createdAt: '',
  items: [{ id: 'a', trackId: 't', title: '英語', minutes: 30, start: 20 * 60, firstStep: '', status: 'planned' } as Plan['items'][number]],
};
const sess = (over: Partial<StartSession>): StartSession => ({ id: 's', lifeDate: '2026-11-09', startedAt: '2026-11-09T11:00:00.000Z', title: 'x', ...over });

describe('lifeMinuteToIso', () => {
  it('JST のカレンダー時刻を実時刻にする（25時は翌1時）', () => {
    expect(lifeMinuteToIso('2026-11-09', 20 * 60)).toBe('2026-11-09T11:00:00.000Z');
    expect(lifeMinuteToIso('2026-11-09', 25 * 60)).toBe('2026-11-09T16:00:00.000Z');
  });
});

describe('autoEndAt（押さずに終える時刻）', () => {
  it('計画の行き先は予定の終わり時刻', () => {
    expect(autoEndAt(sess({ planItemId: 'a', startedAt: '2026-11-09T11:05:00.000Z' }), [plan])).toBe('2026-11-09T11:30:00.000Z');
  });
  it('終わりを過ぎてから始めたら、始めてから予定の長さぶん', () => {
    expect(autoEndAt(sess({ planItemId: 'a', startedAt: '2026-11-09T12:00:00.000Z' }), [plan])).toBe('2026-11-09T12:30:00.000Z');
  });
  it('その場の5分は30分', () => {
    expect(autoEndAt(sess({ quick: true, startedAt: '2026-11-09T01:00:00.000Z' }), [plan])).toBe('2026-11-09T01:30:00.000Z');
  });
});

describe('autoEndSessions / startSession', () => {
  it('終える時刻を過ぎたものだけ auto で終える', async () => {
    const d = fresh();
    await d.plans.put(plan);
    await d.starts.bulkPut([
      sess({ id: 'p', planItemId: 'a', startedAt: '2026-11-09T11:05:00.000Z' }),
      sess({ id: 'q', quick: true, startedAt: '2026-11-09T11:20:00.000Z' }),
    ]);
    expect(await autoEndSessions('2026-11-09T11:40:00.000Z', d)).toBe(1);
    const p = await d.starts.get('p');
    expect(p?.endedAt).toBe('2026-11-09T11:30:00.000Z');
    expect(p?.outcome).toBe('auto');
    expect((await d.starts.get('q'))?.endedAt).toBeUndefined();
  });
  it('次を始めたら、前のものは終わる', async () => {
    const d = fresh();
    await d.starts.put(sess({ id: 'old', quick: true, startedAt: '2020-01-01T00:00:00.000Z' }));
    const s = await startSession({ lifeDate: '2026-11-09', title: '次' }, d);
    const old = await d.starts.get('old');
    expect(old?.outcome).toBe('auto');
    expect(old?.endedAt).toBe(s.startedAt);
    expect((await d.starts.get(s.id))?.endedAt).toBeUndefined();
  });
});
