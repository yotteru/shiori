import { describe, expect, it } from 'vitest';
import { allocation, defaultWeekOffset, freeMinutes, isHoliday, quickCount, weekDates, weekSquares } from './week';
import type { Plan, PlanItem, Routine, StartSession } from './types';

const plan = (lifeDate: string, x: Partial<Plan> = {}, items: Partial<PlanItem>[] = []): Plan => ({
  lifeDate,
  window: { start: '19:00', end: '22:00' },
  createdAt: '',
  source: 'night',
  items: items.map((i, k) => ({ id: `${lifeDate}-${k}`, trackId: 't', title: '', minutes: 60, firstStep: '', status: 'planned', start: 600, ...i })),
  ...x,
});
const work: Routine = { id: 'w', title: '仕事', start: 8 * 60 + 30, min: 600, days: [1, 2, 3, 4, 5], createdAt: '' };
const dinner: Routine = { id: 'd', title: '夕食', start: 19 * 60, min: 60, days: [0, 1, 2, 3, 4, 5, 6], createdAt: '' };
const view = { start: 6, end: 24 };

describe('週の見通し', () => {
  it('月〜日の7日。日曜の17時以降は来週を開く', () => {
    expect(weekDates('2026-11-11')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(weekDates('2026-11-15', 1)[0]).toBe('2026-11-16');
    expect(defaultWeekOffset('2026-11-15', 18)).toBe(1);
    expect(defaultWeekOffset('2026-11-15', 10)).toBe(0);
    expect(defaultWeekOffset('2026-11-14', 20)).toBe(0);
  });

  it('休日は土日と「休日として扱う」日', () => {
    expect(isHoliday('2026-11-14')).toBe(true);
    expect(isHoliday('2026-11-13')).toBe(false);
    expect(isHoliday('2026-11-13', plan('2026-11-13', { holiday: true }))).toBe(true);
  });

  it('空き時間：表示の時間帯から決まっている予定を引く（重なりは1回）。終日の予定があれば0', () => {
    expect(freeMinutes('2026-11-10', [work, dinner], undefined, view)).toBe(18 * 60 - 600 - 60);
    const p = plan('2026-11-11', { extraFixed: [{ id: 'x', title: '飲み会', start: 19 * 60 + 30, min: 150 }] });
    expect(freeMinutes('2026-11-11', [work, dinner], p, view)).toBe(18 * 60 - 600 - 180);
    expect(freeMinutes('2026-11-14', [work, dinner], plan('2026-11-14', { extraFixed: [{ id: 'y', title: '出張', start: 0, min: 1440, allDay: true }] }), view)).toBe(0);
    // 休日扱いの金曜は仕事が入らない
    expect(freeMinutes('2026-11-13', [work, dinner], plan('2026-11-13', { holiday: true }), view)).toBe(18 * 60 - 60);
  });

  it('札を付けた日を取り組みごとに並べる', () => {
    const dates = weekDates('2026-11-09');
    const a = allocation([plan('2026-11-10', { intents: ['addin'] }), plan('2026-11-14', { intents: ['addin', 'gym'] })], dates);
    expect(a.addin).toEqual([false, true, false, false, false, true, false]);
    expect(a.gym[5]).toBe(true);
  });
});

describe('振り返りの7マス', () => {
  it('済＞始めた＞置いただけ＞なし。その場の5分は回数だけ', () => {
    const dates = weekDates('2026-11-09');
    const plans = [
      plan('2026-11-09', {}, [{ trackId: 'a', status: 'done' }]),
      plan('2026-11-10', {}, [{ trackId: 'a', status: 'planned' }]),
      plan('2026-11-11', {}, [{ trackId: 'a', status: 'undone' }]),
    ];
    const s = (x: Partial<StartSession>): StartSession => ({ id: Math.random().toString(), lifeDate: '2026-11-11', startedAt: '', title: '', ...x });
    const sq = weekSquares(plans, [s({ trackId: 'a', outcome: 'stopped' }), s({ quick: true }), s({ quick: true, lifeDate: '2026-11-01' })], dates);
    expect(sq.a).toEqual(['full', 'plan', 'half', 'none', 'none', 'none', 'none']);
    expect(quickCount([s({ quick: true }), s({ quick: true, lifeDate: '2026-11-01' })], dates)).toBe(1);
  });
});
