import { describe, expect, it } from 'vitest';
import { isLeftoverActive, shelveExpired, unshelve } from './leftovers';
import type { Leftover } from './types';

const lo = (id: string, fromLifeDate: string, shelvedAt?: string): Leftover => ({
  id,
  fromLifeDate,
  shelvedAt,
  item: { id: `i-${id}`, trackId: 't1', title: 'x', minutes: 30, firstStep: '', status: 'undone' },
});

describe('やり残しの保留（受け入れテスト 3）', () => {
  it('3生活日以内は候補、過ぎると保留に移る', () => {
    const list = [lo('a', '2026-11-04'), lo('b', '2026-11-01'), lo('c', '2026-10-31')];
    const today = '2026-11-04';
    expect(list.map((l) => isLeftoverActive(l, today))).toEqual([true, true, false]);
    const shelved = shelveExpired(list, today, '2026-11-04T10:00:00.000Z');
    expect(shelved.map((l) => l.id)).toEqual(['c']);
    expect(shelved[0].shelvedAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('月をまたいでも生活日で数える', () => {
    expect(isLeftoverActive(lo('a', '2026-11-28'), '2026-12-01')).toBe(true);
    expect(isLeftoverActive(lo('a', '2026-11-27'), '2026-12-01')).toBe(false);
  });

  it('保留済みは候補に出ず、二重に保留されない', () => {
    const s = lo('a', '2026-10-01', '2026-10-05T00:00:00.000Z');
    expect(isLeftoverActive(s, '2026-11-04')).toBe(false);
    expect(shelveExpired([s], '2026-11-04', 'x')).toEqual([]);
  });

  it('候補に戻すと今日から3日間また候補に出る', () => {
    const back = unshelve(lo('a', '2026-10-01', '2026-10-05T00:00:00.000Z'), '2026-11-04');
    expect(back.shelvedAt).toBeUndefined();
    expect(isLeftoverActive(back, '2026-11-04')).toBe(true);
  });
});
