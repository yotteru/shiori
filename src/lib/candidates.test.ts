import { describe, expect, it } from 'vitest';
import { buildCandidates, lastDoneByTrack, morningCandidates } from './candidates';
import type { Leftover, Plan, Step, Track } from './types';

const today = '2026-11-04';

const track = (id: string, type: Track['type'], createdAt: string, extra: Partial<Track> = {}): Track => ({
  id,
  name: `name-${id}`,
  type,
  createdAt,
  ...extra,
});

const step = (id: string, trackId: string, order: number, status: Step['status'] = 'todo'): Step => ({
  id,
  trackId,
  order,
  title: `step-${id}`,
  minutes: 45,
  firstStep: `first-${id}`,
  status,
});

const leftover = (id: string, trackId: string, fromLifeDate: string, stepId?: string): Leftover => ({
  id,
  fromLifeDate,
  item: { id: `pi-${id}`, trackId, stepId, title: `lo-${id}`, minutes: 30, firstStep: 'f', status: 'undone' },
});

const tracks: Track[] = [
  track('addin', 'project', '2026-10-01T00:00:00Z', { lastNote: { text: '判定が二重', at: '2026-10-31T12:00:00Z' } }),
  track('gym', 'habit', '2026-10-02T00:00:00Z', { defaultMinutes: 90, defaultFirstStep: 'バッグを持って家を出る' }),
  track('book', 'project', '2026-10-03T00:00:00Z'),
  track('old', 'habit', '2026-09-01T00:00:00Z', { archivedAt: '2026-10-01T00:00:00Z' }),
];

const steps: Step[] = [
  step('a1', 'addin', 1, 'done'),
  step('a3', 'addin', 3),
  step('a2', 'addin', 2),
  step('b1', 'book', 1),
];

describe('候補の作成（受け入れテスト 2）', () => {
  it('やり残し → プロジェクト型の先頭ステップ → 習慣型 の順', () => {
    const cands = buildCandidates({ today, tracks, steps, leftovers: [leftover('L1', 'book', '2026-11-03', 'b1')] });
    expect(cands.map((c) => [c.kind, c.key])).toEqual([
      ['leftover', 'step:b1'],
      ['project', 'step:a2'],
      ['habit', 'habit:gym'],
    ]);
  });

  it('同じものは重複させない（やり残しと同じステップ・同じ習慣は1件だけ）', () => {
    const cands = buildCandidates({
      today,
      tracks,
      steps,
      leftovers: [
        leftover('L1', 'gym', '2026-11-04'),
        leftover('L2', 'gym', '2026-11-03'),
        leftover('L3', 'addin', '2026-11-02', 'a2'),
      ],
    });
    const keys = cands.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(cands.map((c) => [c.kind, c.key])).toEqual([
      ['leftover', 'habit:gym'],
      ['leftover', 'step:a2'],
      ['project', 'step:b1'],
    ]);
    expect(cands[0].leftoverId).toBe('L1'); // 新しいやり残しを残す
  });

  it('3生活日を過ぎたやり残し・保留中・終了した取り組み・完了済みステップは出さない', () => {
    const shelved: Leftover = { ...leftover('L2', 'gym', '2026-11-04'), shelvedAt: '2026-11-04T00:00:00Z' };
    const cands = buildCandidates({
      today,
      tracks,
      steps,
      leftovers: [
        leftover('L1', 'gym', '2026-10-31'),
        shelved,
        leftover('L3', 'old', '2026-11-04'),
        leftover('L4', 'addin', '2026-11-04', 'a1'),
      ],
    });
    expect(cands.every((c) => c.kind !== 'leftover')).toBe(true);
    expect(cands.some((c) => c.trackId === 'old')).toBe(false);
  });

  it('前回の続きと習慣型の既定値を添える', () => {
    const cands = buildCandidates({ today, tracks, steps, leftovers: [] });
    expect(cands.find((c) => c.trackId === 'addin')?.lastNote?.text).toBe('判定が二重');
    const gym = cands.find((c) => c.trackId === 'gym');
    expect([gym?.minutes, gym?.firstStep]).toEqual([90, 'バッグを持って家を出る']);
  });

  it('全ステップ完了のプロジェクト型は候補に出ない', () => {
    const cands = buildCandidates({ today, tracks, steps: [step('b1', 'book', 1, 'done')], leftovers: [] });
    expect(cands.some((c) => c.trackId === 'book')).toBe(false);
  });
});

describe('朝の簡易版の並べ方（§3.2）', () => {
  it('前回の続きが新しい順。lastNote がなければ最後に済をつけた日時。どちらもないものは §2.3 の順で最後', () => {
    const ts: Track[] = [
      track('p1', 'project', '2026-10-01T00:00:00Z', { lastNote: { text: 'x', at: '2026-11-01T00:00:00Z' } }),
      track('p2', 'project', '2026-10-02T00:00:00Z'),
      track('h1', 'habit', '2026-10-03T00:00:00Z'),
      track('h2', 'habit', '2026-10-04T00:00:00Z', { lastNote: { text: 'y', at: '2026-11-03T00:00:00Z' } }),
      track('h3', 'habit', '2026-10-05T00:00:00Z'),
    ];
    const ss = [step('s1', 'p1', 1), step('s2', 'p2', 1)];
    const plans: Plan[] = [
      {
        lifeDate: '2026-11-02',
        window: { start: '19:00', end: '22:00' },
        createdAt: '2026-11-01T14:00:00Z',
        source: 'night',
        items: [
          { id: 'i1', trackId: 'h1', title: 'h1', minutes: 30, firstStep: '', status: 'done', doneAt: '2026-11-02T11:00:00Z' },
        ],
      },
    ];
    const cands = buildCandidates({ today, tracks: ts, steps: ss, leftovers: [] });
    expect(cands.map((c) => c.trackId)).toEqual(['p1', 'p2', 'h1', 'h2', 'h3']);
    const morning = morningCandidates(cands, ts, lastDoneByTrack(plans, ss));
    expect(morning.map((c) => c.trackId)).toEqual(['h2', 'h1', 'p1']);
    // 記録が何もなければ §2.3 の順の上位3件
    expect(morningCandidates(cands, ts.map((t) => ({ ...t, lastNote: undefined })), {}).map((c) => c.trackId)).toEqual([
      'p1',
      'p2',
      'h1',
    ]);
  });

  it('lastDoneByTrack はステップの完了日時も見る', () => {
    expect(lastDoneByTrack([], [{ ...step('s', 'p', 1, 'done'), doneAt: '2026-11-01T00:00:00Z' }])).toEqual({
      p: '2026-11-01T00:00:00Z',
    });
  });
});
