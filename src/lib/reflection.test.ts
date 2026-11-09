import { beforeEach, describe, expect, it } from 'vitest';
import { markDone } from './actions';
import type { Candidate } from './candidates';
import { placeIntents } from './calendarActions';
import { ShioriDB } from './db';
import { addChange, addMeasure, createNumberTrack, measureSeries, parseMeasure, plannedNights, timeline, weekFeel } from './reflection';
import type { Plan, PlanItem, Routine } from './types';

const plan = (lifeDate: string, items: Partial<PlanItem>[] = [], x: Partial<Plan> = {}): Plan => ({
  lifeDate,
  window: { start: '19:00', end: '22:00' },
  createdAt: '',
  source: 'night',
  items: items.map((i, k) => ({ id: `${lifeDate}-${k}`, trackId: 't', title: 'ジム', minutes: 60, firstStep: '', status: 'done', start: 600, ...i })),
  ...x,
});

let db: ShioriDB;
beforeEach(async () => {
  db = new ShioriDB(`refl-${Math.random()}`);
  await db.open();
});

describe('ふりかえり（1行ジャーナルの一覧）', () => {
  it('新しい順・週ごと。何もない日と未来の日は出さない', () => {
    const w = timeline(
      {
        journals: [{ lifeDate: '2026-11-10', text: '雨だった', updatedAt: '' }, { lifeDate: '2026-11-03', text: '  ', updatedAt: '' }],
        plans: [plan('2026-11-09', [{ feel: 3 }]), plan('2026-11-12', [{}])],
        changes: [{ id: 'c', trackId: 't', lifeDate: '2026-11-02', text: 'ベルトの穴が1つ縮んだ', createdAt: '' }],
        measures: [],
      },
      '2026-11-11',
      2,
    );
    expect(w.map((x) => x.monday)).toEqual(['2026-11-09', '2026-11-02']);
    expect(w[0].days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-09']);
    expect(w[0].days[1].done[0].feel).toBe(3);
    expect(w[1].days.map((d) => d.date)).toEqual(['2026-11-02']);
  });
});

describe('手応えと夜の計画', () => {
  it('7マスの手応えはその日の最高。前の晩に組んだ日は night で行き先がある日', () => {
    const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
    const plans = [
      plan('2026-11-09', [{ feel: 1 }, { feel: 3 }]),
      plan('2026-11-10', [{ status: 'planned', feel: 2 }], { source: 'morning-quick' }),
      plan('2026-11-11', [], {}),
    ];
    expect(weekFeel(plans, dates).t.slice(0, 2)).toEqual([3, undefined]);
    expect(plannedNights(plans, dates).slice(0, 3)).toEqual([true, false, false]);
  });

  it('済のときの手応えを残す', async () => {
    await db.tracks.put({ id: 't', name: 'ジム', type: 'habit', createdAt: '' });
    await db.plans.put(plan('2026-11-09', [{ status: 'planned' }]));
    await markDone('2026-11-09', '2026-11-09-0', '', db, 2);
    expect((await db.plans.get('2026-11-09'))!.items[0].feel).toBe(2);
  });

  it('札のぶんを置く：平日は18時以降の空きに、置き済みの取り組みは置かない', async () => {
    const work: Routine = { id: 'w', title: '仕事', start: 510, min: 600, days: [1, 2, 3, 4, 5], createdAt: '' };
    await db.plans.put(plan('2026-11-10', [{ trackId: 'b', start: 1140, status: 'planned' }], { intents: ['a', 'b'] }));
    const c = (trackId: string): Candidate => ({ key: trackId, kind: 'habit', trackId, trackName: trackId, trackType: 'habit', title: trackId, minutes: 60, firstStep: '' });
    const n = await placeIntents('2026-11-10', [c('a'), c('b')], [work], { start: 6, end: 24 }, db);
    expect(n).toBe(1);
    const items = (await db.plans.get('2026-11-10'))!.items;
    expect(items.find((i) => i.trackId === 'a')?.start).toBe(20 * 60); // 19時台は置き済みの b、18:30〜19:00 は短い
  });
});

describe('数値型', () => {
  it('数字は全角・カンマも読める。日ごとに最後の値', async () => {
    expect(parseMeasure('７２．５')).toBe(72.5);
    expect(parseMeasure('1,200')).toBe(1200);
    expect(parseMeasure('abc')).toBeNull();
    const t = await createNumberTrack({ name: '体重', unit: 'kg', target: 70 }, db);
    expect([t.type, t.unit, t.target]).toEqual(['number', 'kg', 70]);
    await addMeasure(t.id, 72.4, '2026-11-09', db);
    await new Promise((r) => setTimeout(r, 5));
    await addMeasure(t.id, 72.1, '2026-11-09', db);
    await addMeasure(t.id, 71.9, '2026-11-10', db);
    expect(measureSeries(await db.measures.toArray(), t.id, '2026-11-01', '2026-11-30')).toEqual([
      { date: '2026-11-09', value: 72.1 },
      { date: '2026-11-10', value: 71.9 },
    ]);
  });

  it('変化メモは空なら入れない', async () => {
    expect(await addChange('t', ' ', '2026-11-09', db)).toBeUndefined();
    expect((await addChange('t', '服がゆるい', '2026-11-09', db))?.text).toBe('服がゆるい');
  });
});
