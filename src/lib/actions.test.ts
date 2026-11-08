import { afterEach, describe, expect, it } from 'vitest';
import { finalizeReview, markDone, quickStart, revertDone, savePlan } from './actions';
import { buildCandidates } from './candidates';
import { setDebugNow } from './clock';
import { getMeta, ShioriDB } from './db';
import type { Plan } from './types';

let n = 0;
const fresh = () => new ShioriDB(`actions-${n++}`);
afterEach(() => setDebugNow(null));

async function seed(d: ShioriDB) {
  await d.tracks.bulkPut([
    { id: 'p', name: 'アドイン', type: 'project', createdAt: '2026-10-01T00:00:00Z', lastNote: { text: '古いメモ', at: '2026-10-30T00:00:00Z' } },
    { id: 'h', name: '筋トレ', type: 'habit', createdAt: '2026-10-02T00:00:00Z', defaultMinutes: 90 },
  ]);
  await d.steps.bulkPut([
    { id: 's1', trackId: 'p', order: 1, title: '検証', minutes: 45, firstStep: 'モデルを作る', status: 'todo' },
    { id: 's2', trackId: 'p', order: 2, title: '仕様', minutes: 30, firstStep: 'メモを読む', status: 'todo' },
  ]);
  const plan: Plan = {
    lifeDate: '2026-11-04',
    window: { start: '19:00', end: '22:30' },
    createdAt: '2026-11-03T14:00:00Z',
    source: 'night',
    items: [
      { id: 'i1', trackId: 'p', stepId: 's1', title: '検証', minutes: 45, firstStep: 'モデルを作る', status: 'planned' },
      { id: 'i2', trackId: 'h', title: '筋トレ', minutes: 90, firstStep: '', status: 'planned' },
    ],
  };
  await d.plans.put(plan);
}

describe('済をつける・取り消す（§3.3、手動テスト 11 の自動版）', () => {
  it('次はここからを書くと前回の続きになり、次の候補はステップ2になる。取り消すと元に戻る', async () => {
    const d = fresh();
    await seed(d);
    setDebugNow('2026-11-04T20:00:00+09:00');
    await markDone('2026-11-04', 'i1', '  壁跨ぎの判定から  ', d);
    expect((await d.tracks.get('p'))?.lastNote?.text).toBe('壁跨ぎの判定から');
    expect((await d.steps.get('s1'))?.status).toBe('done');
    const plan = await d.plans.get('2026-11-04');
    expect(plan?.items[0]).toMatchObject({ status: 'done', nextNote: '壁跨ぎの判定から' });

    const cands = buildCandidates({ today: '2026-11-04', tracks: await d.tracks.toArray(), steps: await d.steps.toArray(), leftovers: [] });
    expect(cands.find((c) => c.trackId === 'p')).toMatchObject({ stepId: 's2', lastNote: { text: '壁跨ぎの判定から' } });

    await revertDone('2026-11-04', 'i1', d);
    expect((await d.tracks.get('p'))?.lastNote?.text).toBe('古いメモ');
    expect((await d.steps.get('s1'))?.status).toBe('todo');
    expect((await d.plans.get('2026-11-04'))?.items[0].status).toBe('planned');
  });

  it('空欄の済は前回の続きを変えない', async () => {
    const d = fresh();
    await seed(d);
    await markDone('2026-11-04', 'i1', '', d);
    expect((await d.tracks.get('p'))?.lastNote?.text).toBe('古いメモ');
  });
});

describe('夜の流れ', () => {
  it('答え合わせで未はやり残しに入り、決め直すと消える', async () => {
    const d = fresh();
    await seed(d);
    await finalizeReview('2026-11-04', { i1: 'done', i2: 'undone' }, d);
    expect((await d.leftovers.toArray()).map((l) => [l.id, l.fromLifeDate])).toEqual([['i2', '2026-11-04']]);
    expect((await d.steps.get('s1'))?.status).toBe('done');
    await finalizeReview('2026-11-04', { i1: 'undone', i2: 'done' }, d);
    expect((await d.leftovers.toArray()).map((l) => l.id)).toEqual(['i1']);
    expect((await d.steps.get('s1'))?.status).toBe('todo');
  });

  it('計画の保存は端末内に先に保存し、使ったやり残しを消す。送信できない日付は再送待ちに残る', async () => {
    const d = fresh();
    await d.leftovers.put({ id: 'L', fromLifeDate: '2026-11-04', item: { id: 'x', trackId: 'h', title: '筋トレ', minutes: 90, firstStep: '', status: 'undone' } });
    const res = await savePlan(
      { lifeDate: '2026-11-05', window: { start: '19:00', end: '22:30' }, createdAt: '2026-11-04T14:00:00Z', source: 'night', items: [] },
      ['L'],
      d,
    );
    expect(await d.plans.get('2026-11-05')).toBeTruthy();
    expect(await d.leftovers.count()).toBe(0);
    expect(res.ping).toBe('skipped'); // テストでは Supabase 未設定
    expect((await getMeta(d)).pendingPings).toEqual(['2026-11-05']);
  });
});

describe('朝の簡易版', () => {
  it('1タップで今日の計画ができ、二重には作らない', async () => {
    const d = fresh();
    await seed(d);
    await d.plans.delete('2026-11-04');
    setDebugNow('2026-11-04T08:07:00+09:00');
    const [c] = buildCandidates({ today: '2026-11-04', tracks: await d.tracks.toArray(), steps: await d.steps.toArray(), leftovers: [] });
    await quickStart('2026-11-04', c, d);
    await quickStart('2026-11-04', c, d);
    const plan = await d.plans.get('2026-11-04');
    expect(plan?.source).toBe('morning-quick');
    expect(plan?.items).toHaveLength(1);
    expect(plan?.window.start).toBe('08:00');
  });
});

describe('取り組みと保留', () => {
  it('ステップの並び替えは order を振り直し、追加は末尾に入る', async () => {
    const { addStep, moveStepUp } = await import('./actions');
    const d = fresh();
    await seed(d);
    await moveStepUp('s2', d);
    await addStep('p', { title: '仕上げ', minutes: 60, firstStep: '' }, d);
    const list = (await d.steps.where('trackId').equals('p').toArray()).sort((a, b) => a.order - b.order);
    expect(list.map((s) => [s.id, s.order])).toEqual([
      ['s2', 1],
      ['s1', 2],
      [list[2].id, 3],
    ]);
    expect(list[2].title).toBe('仕上げ');
  });

  it('終了した取り組みは候補から消え、戻すと出る', async () => {
    const { archiveTrack } = await import('./actions');
    const d = fresh();
    await seed(d);
    await archiveTrack('h', true, d);
    const c1 = buildCandidates({ today: '2026-11-04', tracks: await d.tracks.toArray(), steps: [], leftovers: [] });
    expect(c1.some((c) => c.trackId === 'h')).toBe(false);
    await archiveTrack('h', false, d);
    expect((await d.tracks.get('h'))?.archivedAt).toBeUndefined();
  });

  it('保留から候補に戻す', async () => {
    const { restoreLeftover } = await import('./actions');
    const d = fresh();
    await d.leftovers.put({ id: 'L', fromLifeDate: '2026-10-01', shelvedAt: '2026-10-05T00:00:00Z', item: { id: 'x', trackId: 'h', title: 't', minutes: 30, firstStep: '', status: 'undone' } });
    await restoreLeftover('L', '2026-11-04', d);
    expect(await d.leftovers.get('L')).toMatchObject({ fromLifeDate: '2026-11-04' });
    expect((await d.leftovers.get('L'))?.shelvedAt).toBeUndefined();
  });
});

describe('取り組みの削除と種類の変更', () => {
  it('削除するとステップ・予定（済も）・やり残しもまとめて消える。ほかの取り組みは残る', async () => {
    const { deleteTrack } = await import('./actions');
    const d = fresh();
    await seed(d);
    await d.leftovers.put({ id: 'L', fromLifeDate: '2026-11-03', item: { id: 'z', trackId: 'p', title: 'x', minutes: 30, firstStep: '', status: 'undone' } });
    await markDone('2026-11-04', 'i1', '', d);
    await deleteTrack('p', d);
    expect(await d.tracks.get('p')).toBeUndefined();
    expect(await d.steps.where('trackId').equals('p').count()).toBe(0);
    expect(await d.leftovers.count()).toBe(0);
    expect((await d.plans.get('2026-11-04'))?.items.map((i) => i.trackId)).toEqual(['h']);
    expect(await d.tracks.get('h')).toBeTruthy();
  });

  it('種類を変えてもステップは残る', async () => {
    const { changeTrackType } = await import('./actions');
    const d = fresh();
    await seed(d);
    await changeTrackType('p', 'habit', d);
    expect((await d.tracks.get('p'))?.type).toBe('habit');
    expect(await d.steps.where('trackId').equals('p').count()).toBe(2);
  });
});
