import { afterEach, describe, expect, it } from 'vitest';
import { isDebugNowActive, now, setDebugNow } from './clock';
import { getMeta, isLocalDataEmpty, loadClockOverride, saveDebugNow, ShioriDB, updateMeta } from './db';

let n = 0;
const fresh = () => new ShioriDB(`test-${n++}`);

afterEach(() => setDebugNow(null));

describe('端末内データ', () => {
  it('Meta は既定値から始まり、部分更新できる', async () => {
    const d = fresh();
    expect(await getMeta(d)).toEqual({ key: 'meta', schemaVersion: 1, onboarded: false });
    await updateMeta({ onboarded: true }, d);
    expect((await getMeta(d)).onboarded).toBe(true);
  });

  it('日時の上書きを保存・復元・解除できる', async () => {
    const d = fresh();
    await saveDebugNow('2026-11-05T00:30:00+09:00', d);
    expect(now().toISOString()).toBe('2026-11-04T15:30:00.000Z');
    setDebugNow(null);
    await loadClockOverride(d);
    expect(isDebugNowActive()).toBe(true);
    await saveDebugNow(null, d);
    expect(isDebugNowActive()).toBe(false);
    expect((await getMeta(d)).debugNow).toBeUndefined();
  });

  it('空かどうかを判定できる', async () => {
    const d = fresh();
    expect(await isLocalDataEmpty(d)).toBe(true);
    await d.tracks.put({ id: 't', name: 'x', type: 'habit', createdAt: '2026-11-04T00:00:00Z' });
    expect(await isLocalDataEmpty(d)).toBe(false);
  });
});
