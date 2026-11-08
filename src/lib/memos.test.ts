import { beforeEach, describe, expect, it } from 'vitest';
import { ShioriDB } from './db';
import { addMemo, deleteMemo, shapeMemo, sortMemos } from './memos';

let db: ShioriDB;
beforeEach(async () => {
  db = new ShioriDB(`memo-${Math.random()}`);
  await db.open();
});

describe('メモ箱', () => {
  it('1行で入れる。空は入れない', async () => {
    expect(await addMemo('  ', db)).toBeUndefined();
    const m = await addMemo(' 除脂肪したい ', db);
    expect(m?.text).toBe('除脂肪したい');
    expect(await db.memos.count()).toBe(1);
    await deleteMemo(m!.id, db);
    expect(await db.memos.count()).toBe(0);
  });

  it('整えると取り組みができ、メモに印がつく。なりたい状態は空なら持たない', async () => {
    const m = (await addMemo('英語を話せるようになりたい', db))!;
    const t = await shapeMemo(m.id, { name: '英語のやり方を決める', type: 'project', goal: ' 自分に合うやり方が1つ決まる ' }, [{ title: '候補を3つ書く', minutes: 30, firstStep: 'メモ帳を開く' }], db);
    expect((await db.tracks.get(t.id))?.goal).toBe('自分に合うやり方が1つ決まる');
    expect(await db.steps.where('trackId').equals(t.id).count()).toBe(1);
    const after = await db.memos.get(m.id);
    expect(after?.trackId).toBe(t.id);
    expect(after?.madeAt).toBeTruthy();

    const m2 = (await addMemo('ジム', db))!;
    const t2 = await shapeMemo(m2.id, { name: '筋トレ', type: 'habit', goal: ' ' }, [], db);
    expect('goal' in (await db.tracks.get(t2.id))!).toBe(false);
  });

  it('並びは新しい順、取り組みにしたものは後ろ', () => {
    const r = sortMemos([
      { id: 'a', text: '', createdAt: '2026-11-01' },
      { id: 'b', text: '', createdAt: '2026-11-03', trackId: 't' },
      { id: 'c', text: '', createdAt: '2026-11-02' },
    ]);
    expect(r.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});
