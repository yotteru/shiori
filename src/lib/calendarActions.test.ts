import { describe, expect, it } from 'vitest';
import { buildCandidates } from './candidates';
import { fixedBlocksFor, itemsByStart } from './calendar';
import { addExtraFixed, addRoutine, confirmPlan, moveItem, placeCandidate, removeItem, setFixedEdit, setHoliday, updateRoutine } from './calendarActions';
import { getMeta, ShioriDB } from './db';
import { replaceAll, takeSnapshot } from './snapshot';

let n = 0;
const fresh = () => new ShioriDB(`calendar-${n++}`);

async function seed(d: ShioriDB) {
  await d.tracks.bulkPut([
    { id: 'gym', name: '筋トレ', type: 'habit', createdAt: '2026-10-01T00:00:00Z', defaultMinutes: 90 },
    { id: 'eng', name: '英語', type: 'habit', createdAt: '2026-10-02T00:00:00Z', defaultMinutes: 15 },
  ]);
  await d.leftovers.put({ id: 'L', fromLifeDate: '2026-11-08', item: { id: 'x', trackId: 'gym', title: '筋トレ', minutes: 90, firstStep: '', status: 'undone' } });
}

describe('カレンダーの操作', () => {
  it('候補を置くと計画ができ、やり残しから置いたものはやり残しから消える。30分未満は30分になる', async () => {
    const d = fresh();
    await seed(d);
    const cands = buildCandidates({ today: '2026-11-08', tracks: await d.tracks.toArray(), steps: [], leftovers: await d.leftovers.toArray() });
    const gym = cands.find((c) => c.kind === 'leftover')!;
    const eng = cands.find((c) => c.trackId === 'eng')!;
    await placeCandidate('2026-11-09', 'night', gym, 1170, d);
    await placeCandidate('2026-11-09', 'night', eng, 1140, d);
    const plan = (await d.plans.get('2026-11-09'))!;
    expect(plan.source).toBe('night');
    expect(itemsByStart(plan).map((i) => [i.trackId, i.start, i.minutes])).toEqual([
      ['eng', 1140, 30],
      ['gym', 1170, 90],
    ]);
    expect(await d.leftovers.count()).toBe(0);
  });

  it('動かす・外す', async () => {
    const d = fresh();
    await seed(d);
    const [c] = buildCandidates({ today: '2026-11-08', tracks: await d.tracks.toArray(), steps: [], leftovers: [] });
    const item = await placeCandidate('2026-11-08', 'morning-quick', c, 1200, d);
    await moveItem('2026-11-08', item.id, 1230, 105, d);
    expect((await d.plans.get('2026-11-08'))!.items[0]).toMatchObject({ start: 1230, minutes: 105 });
    expect((await d.plans.get('2026-11-08'))!.source).toBe('morning-quick');
    await removeItem('2026-11-08', item.id, d);
    expect((await d.plans.get('2026-11-08'))!.items).toEqual([]);
  });

  it('いつもの固定：その日だけ動かす・外す・戻す。この日だけの予定。休日扱い', async () => {
    const d = fresh();
    const work = await addRoutine({ title: '仕事', start: 540, min: 540, days: [1, 2, 3, 4, 5] }, d);
    const dinner = await addRoutine({ title: '夕食', start: 1110, min: 60, days: [0, 1, 2, 3, 4, 5, 6] }, d);
    const blocks = async () => fixedBlocksFor('2026-11-09', await d.routines.toArray(), await d.plans.get('2026-11-09'));
    expect((await blocks()).map((b) => b.title)).toEqual(['仕事', '夕食']);
    await setFixedEdit('2026-11-09', dinner.id, { start: 1140, min: 45 }, 'night', d);
    await setFixedEdit('2026-11-09', work.id, 'removed', 'night', d);
    await addExtraFixed('2026-11-09', '歯医者', 600, 60, 'night', d);
    expect((await blocks()).map((b) => [b.title, b.start])).toEqual([['歯医者', 600], ['夕食', 1140]]);
    // いつもの固定を変えても、この日に動かした夕食はそのまま。ほかの日には反映される
    await updateRoutine(dinner.id, { start: 1080 }, d);
    expect((await blocks()).find((b) => b.title === '夕食')?.start).toBe(1140);
    expect(fixedBlocksFor('2026-11-10', await d.routines.toArray()).find((b) => b.title === '夕食')?.start).toBe(1080);
    await setFixedEdit('2026-11-09', work.id, undefined, 'night', d);
    expect((await blocks()).map((b) => b.title)).toContain('仕事');
    await setHoliday('2026-11-09', true, 'night', d);
    expect((await blocks()).map((b) => b.title)).toEqual(['歯医者', '夕食']);
  });

  it('「この計画で明日を迎える」は計画した日付を送る（テストでは Supabase 未設定なので再送待ちに残る）', async () => {
    const d = fresh();
    await seed(d);
    const [c] = buildCandidates({ today: '2026-11-08', tracks: await d.tracks.toArray(), steps: [], leftovers: [] });
    await placeCandidate('2026-11-09', 'night', c, 1170, d);
    const r = await confirmPlan('2026-11-09', d);
    expect(r.ping).toBe('skipped');
    expect((await getMeta(d)).pendingPings).toEqual(['2026-11-09']);
  });

  it('いつもの固定もバックアップ・書き出しに含まれる', async () => {
    const src = fresh();
    await addRoutine({ title: '風呂', start: 1380, min: 30, days: [0, 1, 2, 3, 4, 5, 6] }, src);
    const snap = await takeSnapshot(src);
    const dst = fresh();
    await replaceAll(snap, dst);
    expect((await dst.routines.toArray()).map((r) => r.title)).toEqual(['風呂']);
  });
});

describe('始める瞬間の対策（きっかけ・前の晩の準備）', () => {
  it('習慣型のいつものきっかけが置いた予定に付き、あとから書き換えられる', async () => {
    const { editStart } = await import('./calendarActions');
    const d = fresh();
    await d.tracks.put({ id: 'gym', name: '筋トレ', type: 'habit', createdAt: '2026-10-01T00:00:00Z', defaultMinutes: 90, defaultFirstStep: 'バッグを持つ', defaultCue: '帰宅して靴を脱いだら' });
    const [c] = buildCandidates({ today: '2026-11-08', tracks: await d.tracks.toArray(), steps: [], leftovers: [] });
    const item = await placeCandidate('2026-11-09', 'night', c, 1170, d);
    expect(item.cue).toBe('帰宅して靴を脱いだら');
    await editStart('2026-11-09', item.id, { cue: '', firstStep: 'ウェアに着替える' }, d);
    const saved = (await d.plans.get('2026-11-09'))!.items[0];
    expect(saved.cue).toBeUndefined();
    expect(saved.firstStep).toBe('ウェアに着替える');
  });

  it('前の晩の準備を書いて済ませる・消す', async () => {
    const { setPrep } = await import('./calendarActions');
    const d = fresh();
    await setPrep('2026-11-09', { text: ' バッグを玄関に置く ' }, d);
    expect((await d.plans.get('2026-11-09'))!.prep).toEqual({ text: 'バッグを玄関に置く' });
    await setPrep('2026-11-09', { text: 'バッグを玄関に置く', doneAt: '2026-11-08T13:00:00Z' }, d);
    expect((await d.plans.get('2026-11-09'))!.prep?.doneAt).toBe('2026-11-08T13:00:00Z');
    await setPrep('2026-11-09', null, d);
    expect((await d.plans.get('2026-11-09'))!.prep).toBeUndefined();
  });
});

describe('この日だけの予定を直す（2026-11-11）', () => {
  it('名前と時刻を直せる。終日にも、終日から時刻つきにも', async () => {
    const { addExtraFixed, updateExtraFixed } = await import('./calendarActions');
    const d = fresh();
    const id = await addExtraFixed('2026-11-12', '歯医者', 600, 60, 'night', d);
    await updateExtraFixed('2026-11-12', id, { title: '歯医者（再診）', allDay: false, start: 660, min: 90 }, d);
    expect((await d.plans.get('2026-11-12'))?.extraFixed).toEqual([{ id, title: '歯医者（再診）', start: 660, min: 90 }]);
    await updateExtraFixed('2026-11-12', id, { title: '出張', allDay: true, start: 0, min: 0 }, d);
    expect((await d.plans.get('2026-11-12'))?.extraFixed).toEqual([{ id, title: '出張', start: 0, min: 1440, allDay: true }]);
    await updateExtraFixed('2026-11-12', id, { title: '出張', allDay: false, start: 540, min: 120 }, d);
    expect((await d.plans.get('2026-11-12'))?.extraFixed).toEqual([{ id, title: '出張', start: 540, min: 120 }]);
  });
});
