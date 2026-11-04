import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  formatLifeDateJa,
  isEvening,
  jstTime,
  lifeDate,
  planForDate,
  weekStartMonday,
} from './lifeDate';

// JST の壁時計で日時を作る
const jst = (s: string) => new Date(`${s}+09:00`);

describe('lifeDate（受け入れテスト 1）', () => {
  it('JST 3:59 は前日、4:00 は当日', () => {
    expect(lifeDate(jst('2026-11-05T03:59:59'))).toBe('2026-11-04');
    expect(lifeDate(jst('2026-11-05T04:00:00'))).toBe('2026-11-05');
  });

  it('0:30 は前日扱いで、その夜に組む計画は翌朝の生活日になる', () => {
    const at = jst('2026-11-05T00:30:00');
    expect(lifeDate(at)).toBe('2026-11-04');
    expect(planForDate(at)).toBe('2026-11-05');
  });

  it('月末をまたぐ', () => {
    expect(lifeDate(jst('2026-12-01T03:00:00'))).toBe('2026-11-30');
    expect(lifeDate(jst('2026-12-01T04:00:00'))).toBe('2026-12-01');
    expect(planForDate(jst('2026-11-30T23:00:00'))).toBe('2026-12-01');
  });

  it('年末をまたぐ', () => {
    expect(lifeDate(jst('2027-01-01T03:59:00'))).toBe('2026-12-31');
    expect(lifeDate(jst('2027-01-01T04:00:00'))).toBe('2027-01-01');
    expect(planForDate(jst('2026-12-31T23:30:00'))).toBe('2027-01-01');
  });

  it('うるう年の2月末', () => {
    expect(lifeDate(jst('2028-03-01T02:00:00'))).toBe('2028-02-29');
  });

  it('端末のタイムゾーンに関係なく JST で決まる（UTC で表した同じ瞬間）', () => {
    expect(lifeDate(new Date('2026-11-04T18:59:00Z'))).toBe('2026-11-04'); // JST 3:59
    expect(lifeDate(new Date('2026-11-04T19:00:00Z'))).toBe('2026-11-05'); // JST 4:00
  });
});

describe('日付の補助関数', () => {
  it('addDays / diffDays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-01', '2026-11-04')).toBe(3);
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('isEvening：生活日の 20:00 以降〜翌 3:59', () => {
    expect(isEvening(jst('2026-11-04T19:59:00'))).toBe(false);
    expect(isEvening(jst('2026-11-04T20:00:00'))).toBe(true);
    expect(isEvening(jst('2026-11-05T01:00:00'))).toBe(true);
    expect(isEvening(jst('2026-11-05T04:00:00'))).toBe(false);
  });

  it('jstTime / formatLifeDateJa / weekStartMonday', () => {
    expect(jstTime(new Date('2026-11-04T10:52:00Z'))).toBe('19:52');
    expect(formatLifeDateJa('2026-11-04')).toBe('11月4日（水）');
    expect(weekStartMonday('2026-11-04')).toBe('2026-11-02');
    expect(weekStartMonday('2026-11-08')).toBe('2026-11-02'); // 日曜は前の月曜から
    expect(weekStartMonday('2026-11-09')).toBe('2026-11-09');
  });
});
