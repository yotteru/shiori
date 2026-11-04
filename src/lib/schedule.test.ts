import { describe, expect, it } from 'vitest';
import { assignTimes, capacity, timeOptions, windowLength } from './schedule';

describe('時刻の割り付け（受け入れテスト 4）', () => {
  it('開始時刻＋所要時間＋10分で順に並ぶ', () => {
    expect(assignTimes('19:00', [90, 45, 10])).toEqual(['19:00', '20:40', '21:35']);
  });

  it('日付をまたぐと 00:xx に折り返す', () => {
    expect(assignTimes('23:00', [60, 30])).toEqual(['23:00', '00:10']);
  });

  it('時間内なら警告なし、超えたら警告状態', () => {
    const w = { start: '19:00', end: '22:30' };
    expect(capacity(w, [90, 45, 10])).toEqual({ used: 145, total: 210, remaining: 65, over: false });
    expect(capacity(w, [90, 90, 45]).over).toBe(true);
    expect(capacity(w, [120, 90]).over).toBe(false); // ちょうどは超過ではない
  });

  it('終わりが始まりより前なら日をまたぐ時間帯', () => {
    expect(windowLength({ start: '22:00', end: '01:00' })).toBe(180);
  });

  it('時刻の選択肢は15分刻み', () => {
    const opts = timeOptions();
    expect(opts).toHaveLength(96);
    expect(opts.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
  });
});
