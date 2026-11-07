import { isLeftoverActive } from './leftovers';
import type { Leftover, Plan, Step, Track } from './types';

// 候補の作り方（指示書 §2.3）と、朝の簡易版の並べ方（§3.2）

export const DEFAULT_HABIT_MINUTES = 60;

export interface Candidate {
  /** 重複判定のキー。プロジェクト型は step:<id>、習慣型は habit:<trackId> */
  key: string;
  kind: 'leftover' | 'project' | 'habit';
  trackId: string;
  trackName: string;
  trackType: Track['type'];
  stepId?: string;
  title: string;
  minutes: number;
  firstStep: string;
  /** 前回の続き */
  lastNote?: { text: string; at: string };
  /** やり残しから来た場合 */
  leftoverId?: string;
  fromLifeDate?: string;
}

export interface CandidateInput {
  /** 今日の生活日 */
  today: string;
  tracks: Track[];
  steps: Step[];
  leftovers: Leftover[];
}

export function candidateKey(trackId: string, stepId?: string): string {
  return stepId ? `step:${stepId}` : `habit:${trackId}`;
}

function activeTracks(tracks: Track[]): Track[] {
  return tracks
    .filter((t) => !t.archivedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** 夜の「明日を組む」の候補：やり残し → プロジェクト型の先頭ステップ → 習慣型。重複なし */
export function buildCandidates({ today, tracks, steps, leftovers }: CandidateInput): Candidate[] {
  const live = activeTracks(tracks);
  const trackById = new Map(live.map((t) => [t.id, t]));
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: Candidate[] = [];

  const push = (c: Candidate) => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    out.push(c);
  };

  // 1. やり残し（新しいものから）
  const recent = leftovers
    .filter((l) => isLeftoverActive(l, today))
    .sort((a, b) => b.fromLifeDate.localeCompare(a.fromLifeDate));
  for (const l of recent) {
    const track = trackById.get(l.item.trackId);
    if (!track) continue;
    if (l.item.stepId && stepById.get(l.item.stepId)?.status === 'done') continue;
    push({
      key: candidateKey(track.id, l.item.stepId),
      kind: 'leftover',
      trackId: track.id,
      trackName: track.name,
      trackType: track.type,
      stepId: l.item.stepId,
      title: l.item.title,
      minutes: l.item.minutes,
      firstStep: l.item.firstStep,
      lastNote: track.lastNote,
      leftoverId: l.id,
      fromLifeDate: l.fromLifeDate,
    });
  }

  // 2. プロジェクト型：未完了ステップのうち order が最小のもの
  for (const track of live.filter((t) => t.type === 'project')) {
    const next = steps
      .filter((s) => s.trackId === track.id && s.status === 'todo')
      .sort((a, b) => a.order - b.order)[0];
    if (!next) continue;
    push({
      key: candidateKey(track.id, next.id),
      kind: 'project',
      trackId: track.id,
      trackName: track.name,
      trackType: 'project',
      stepId: next.id,
      title: next.title,
      minutes: next.minutes,
      firstStep: next.firstStep,
      lastNote: track.lastNote,
    });
  }

  // 3. 習慣型：取り組みごとに1件、既定値で
  for (const track of live.filter((t) => t.type === 'habit')) {
    push({
      key: candidateKey(track.id),
      kind: 'habit',
      trackId: track.id,
      trackName: track.name,
      trackType: 'habit',
      title: track.name,
      minutes: track.defaultMinutes ?? DEFAULT_HABIT_MINUTES,
      firstStep: track.defaultFirstStep ?? '',
      lastNote: track.lastNote,
    });
  }

  return out;
}

/** 取り組みごとの「最後に済をつけた日時」（ISO）。計画とステップの記録から求める */
export function lastDoneByTrack(plans: Plan[], steps: Step[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const bump = (trackId: string, at?: string) => {
    if (at && (!out[trackId] || at > out[trackId])) out[trackId] = at;
  };
  for (const p of plans) for (const i of p.items) if (i.status === 'done') bump(i.trackId, i.doneAt);
  for (const s of steps) if (s.status === 'done') bump(s.trackId, s.doneAt);
  return out;
}

/**
 * 朝の簡易版の候補（§3.2）：前回の続きが新しい順。
 * 基準はその取り組みの lastNote.at、なければ最後に済をつけた日時。
 * どちらもない候補は最後に回し、その中では §2.3 の順を保つ。
 */
export function morningCandidates(
  candidates: Candidate[],
  tracks: Track[],
  lastDone: Record<string, string>,
  limit = 3,
): Candidate[] {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const recency = (c: Candidate) => trackById.get(c.trackId)?.lastNote?.at ?? lastDone[c.trackId];
  return candidates
    .map((c, index) => ({ c, index, at: recency(c) }))
    .sort((a, b) => {
      if (a.at && b.at) return b.at.localeCompare(a.at) || a.index - b.index;
      if (a.at) return -1;
      if (b.at) return 1;
      return a.index - b.index;
    })
    .slice(0, limit)
    .map((x) => x.c);
}
