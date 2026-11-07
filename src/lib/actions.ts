import type { Candidate } from './candidates';
import { nowIso, now } from './clock';
import { db, requestPersistentStorage, updateMeta, type ShioriDB } from './db';
import { newId } from './id';
import { jstTime } from './lifeDate';
import { formatHm, parseHm } from './schedule';
import { pushPlanningPing, type SyncResult } from './sync';
import { JOURNAL_MAX_LENGTH, type Plan, type PlanItem, type Step, type Track } from './types';

// 画面から呼ぶデータ操作。端末内の保存を必ず先に済ませる

export const DEFAULT_WINDOW = { start: '19:00', end: '22:30' };

export function itemFromCandidate(c: Candidate): PlanItem {
  return {
    id: newId(),
    trackId: c.trackId,
    stepId: c.stepId,
    title: c.title,
    minutes: c.minutes,
    firstStep: c.firstStep,
    status: 'planned',
  };
}

// ---- 初回案内・取り組み ----

export interface NewStep {
  title: string;
  minutes: number;
  firstStep: string;
}

export async function createTrack(
  input: Pick<Track, 'name' | 'type' | 'defaultMinutes' | 'defaultFirstStep'>,
  steps: NewStep[] = [],
  database: ShioriDB = db,
): Promise<Track> {
  const track: Track = { id: newId(), createdAt: nowIso(), ...input };
  const rows: Step[] = steps.map((s, i) => ({
    id: newId(),
    trackId: track.id,
    order: i + 1,
    title: s.title,
    minutes: s.minutes,
    firstStep: s.firstStep,
    status: 'todo',
  }));
  await database.transaction('rw', database.tracks, database.steps, async () => {
    await database.tracks.add(track);
    if (rows.length) await database.steps.bulkAdd(rows);
  });
  return track;
}

export async function completeOnboarding(
  input: Pick<Track, 'name' | 'type' | 'defaultMinutes' | 'defaultFirstStep'>,
  steps: NewStep[],
  database: ShioriDB = db,
): Promise<void> {
  await createTrack(input, steps, database);
  await updateMeta({ onboarded: true }, database);
  await requestPersistentStorage();
}

// ---- 済をつける・取り消す（§3.3） ----

async function withPlan(
  database: ShioriDB,
  lifeDate: string,
  fn: (plan: Plan, item: PlanItem) => Promise<void>,
  itemId: string,
) {
  await database.transaction('rw', database.plans, database.tracks, database.steps, async () => {
    const plan = await database.plans.get(lifeDate);
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) throw new Error('plan item not found');
    await fn(plan, item);
    await database.plans.put(plan);
  });
}

async function applyDone(database: ShioriDB, item: PlanItem, note: string, at: string) {
  const track = await database.tracks.get(item.trackId);
  const text = note.trim();
  item.status = 'done';
  item.doneAt = at;
  item.prevLastNote = track?.lastNote ?? null;
  if (text) item.nextNote = text;
  else delete item.nextNote;
  if (track && text) await database.tracks.put({ ...track, lastNote: { text, at } });
  if (item.stepId) {
    const step = await database.steps.get(item.stepId);
    if (step) await database.steps.put({ ...step, status: 'done', doneAt: at });
  }
}

async function applyRevert(database: ShioriDB, item: PlanItem, to: 'planned' | 'undone') {
  const doneAt = item.doneAt;
  if (item.status === 'done' && doneAt) {
    const track = await database.tracks.get(item.trackId);
    // この済で書いた「次はここから」がまだ最新なら、前の値に戻す
    if (track && track.lastNote?.at === doneAt && 'prevLastNote' in item) {
      const next = { ...track };
      if (item.prevLastNote) next.lastNote = item.prevLastNote;
      else delete next.lastNote;
      await database.tracks.put(next);
    }
    if (item.stepId) {
      const step = await database.steps.get(item.stepId);
      if (step && step.doneAt === doneAt) {
        const { doneAt: _d, ...rest } = step;
        void _d;
        await database.steps.put({ ...rest, status: 'todo' });
      }
    }
  }
  item.status = to;
  delete item.doneAt;
  delete item.nextNote;
  delete item.prevLastNote;
}

export async function markDone(lifeDate: string, itemId: string, note: string, database: ShioriDB = db) {
  const at = nowIso();
  await withPlan(database, lifeDate, (_p, item) => applyDone(database, item, note, at), itemId);
}

/** 済を取り消して「予定」に戻す（直後の取り消し・長押し） */
export async function revertDone(lifeDate: string, itemId: string, database: ShioriDB = db) {
  await withPlan(database, lifeDate, (_p, item) => applyRevert(database, item, 'planned'), itemId);
}

// ---- 夜の流れ（§3.4） ----

/** 答え合わせを確定する。未は Leftover に入れる（同じ行き先は1件だけ） */
export async function finalizeReview(
  lifeDate: string,
  decisions: Record<string, 'done' | 'undone'>,
  database: ShioriDB = db,
) {
  const at = nowIso();
  await database.transaction('rw', [database.plans, database.tracks, database.steps, database.leftovers], async () => {
    const plan = await database.plans.get(lifeDate);
    if (!plan) return;
    for (const item of plan.items) {
      const d = decisions[item.id];
      if (!d) continue;
      if (d === 'done') {
        if (item.status !== 'done') await applyDone(database, item, '', at);
        await database.leftovers.delete(item.id);
      } else {
        if (item.status !== 'undone') await applyRevert(database, item, 'undone');
        await database.leftovers.put({ id: item.id, fromLifeDate: lifeDate, item: { ...item } });
      }
    }
    await database.plans.put(plan);
  });
}

export async function saveJournal(lifeDate: string, text: string, database: ShioriDB = db) {
  const value = text.slice(0, JOURNAL_MAX_LENGTH);
  if (!value.trim()) {
    await database.journals.delete(lifeDate);
    return;
  }
  await database.journals.put({ lifeDate, text: value, updatedAt: nowIso() });
}

export interface SavePlanResult {
  ping: SyncResult;
  backup: SyncResult;
}

/** バックアップは後の段階で差し込む */
let backupHook: (() => Promise<SyncResult>) | null = null;
export function setBackupHook(fn: (() => Promise<SyncResult>) | null) {
  backupHook = fn;
}

/**
 * 夜の計画を保存する。順番：1 端末内 → 2 planning_pings → 3 自動バックアップ。
 * 2・3 が失敗しても 1 は成功扱い
 */
export async function savePlan(
  plan: Plan,
  usedLeftoverIds: string[],
  database: ShioriDB = db,
): Promise<SavePlanResult> {
  await database.transaction('rw', database.plans, database.leftovers, async () => {
    const prev = await database.plans.get(plan.lifeDate);
    await database.plans.put({ ...plan, createdAt: prev?.createdAt ?? plan.createdAt });
    if (usedLeftoverIds.length) await database.leftovers.bulkDelete(usedLeftoverIds);
  });
  const ping = await pushPlanningPing(plan.lifeDate, database);
  let backup: SyncResult = 'skipped';
  if (backupHook) {
    try {
      backup = await backupHook();
    } catch {
      backup = 'failed';
    }
  }
  return { ping, backup };
}

/** 直近の計画の時間帯（明日を組むときの初期値） */
export async function lastWindow(database: ShioriDB = db): Promise<Plan['window']> {
  const plans = await database.plans.orderBy('lifeDate').reverse().toArray();
  return plans.find((p) => p.source === 'night')?.window ?? DEFAULT_WINDOW;
}

// ---- 朝の簡易版（§3.2） ----

/** 1タップで今日の最初の行き先にする */
export async function quickStart(today: string, c: Candidate, database: ShioriDB = db): Promise<void> {
  const start = parseHm(jstTime(now()));
  const window = { start: formatHm(start - (start % 15)), end: formatHm(start - (start % 15) + Math.max(c.minutes, 15)) };
  const plan: Plan = {
    lifeDate: today,
    window,
    createdAt: nowIso(),
    source: 'morning-quick',
    items: [itemFromCandidate(c)],
  };
  await database.transaction('rw', database.plans, database.leftovers, async () => {
    if (await database.plans.get(today)) return; // 二重タップ対策
    await database.plans.add(plan);
    if (c.leftoverId) await database.leftovers.delete(c.leftoverId);
  });
}
