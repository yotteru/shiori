import { afterPlanSaved, itemFromCandidate, lastWindow, type SavePlanResult } from './actions';
import type { Candidate } from './candidates';
import { MIN_LEN, withStarts } from './calendar';
import { nowIso } from './clock';
import { db, getMeta, updateMeta, type ShioriDB } from './db';
import { newId } from './id';
import type { Plan, PlanItem, Routine } from './types';

// カレンダーでの操作（2026-11-08）。どれも端末内にすぐ保存する（同期は自動）

/** その日の計画を取り出す。なければ作る（明日 = 前の晩に組んだ、今日 = 当日に組んだ） */
async function ensurePlan(database: ShioriDB, lifeDate: string, source: Plan['source']): Promise<Plan> {
  const existing = await database.plans.get(lifeDate);
  if (existing) return { ...existing, items: withStarts(existing) };
  return { lifeDate, window: await lastWindow(database), createdAt: nowIso(), source, items: [] };
}

async function editPlan(
  lifeDate: string,
  source: Plan['source'],
  fn: (plan: Plan) => Plan | void,
  database: ShioriDB = db,
): Promise<Plan> {
  return database.transaction('rw', database.plans, database.leftovers, async () => {
    const plan = await ensurePlan(database, lifeDate, source);
    const next = fn(plan) ?? plan;
    await database.plans.put(next);
    return next;
  });
}

/** 候補を指定の時刻に置く */
export async function placeCandidate(
  lifeDate: string,
  source: Plan['source'],
  c: Candidate,
  start: number,
  database: ShioriDB = db,
): Promise<PlanItem> {
  const item: PlanItem = { ...itemFromCandidate(c), start, minutes: Math.max(MIN_LEN, c.minutes) };
  await editPlan(lifeDate, source, (p) => ({ ...p, items: [...p.items, item] }), database);
  if (c.leftoverId) await database.leftovers.delete(c.leftoverId);
  return item;
}

/** 行き先の時刻・長さを変える */
export async function moveItem(lifeDate: string, itemId: string, start: number, minutes: number, database: ShioriDB = db) {
  await editPlan(
    lifeDate,
    'night',
    (p) => ({ ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, start, minutes: Math.max(MIN_LEN, minutes) } : i)) }),
    database,
  );
}

/** 行き先を外す */
export async function removeItem(lifeDate: string, itemId: string, database: ShioriDB = db) {
  await editPlan(lifeDate, 'night', (p) => ({ ...p, items: p.items.filter((i) => i.id !== itemId) }), database);
}

/** 最初の一手を書き換える */
export async function editFirstStep(lifeDate: string, itemId: string, firstStep: string, database: ShioriDB = db) {
  await editPlan(lifeDate, 'night', (p) => ({ ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, firstStep } : i)) }), database);
}

// ---- その日の固定 ----

/** いつもの固定を、この日だけ動かす（value）・外す（'removed'）・いつもに戻す（undefined） */
export async function setFixedEdit(
  lifeDate: string,
  routineId: string,
  value: { start: number; min: number } | 'removed' | undefined,
  source: Plan['source'] = 'night',
  database: ShioriDB = db,
) {
  await editPlan(
    lifeDate,
    source,
    (p) => {
      const edits = { ...(p.fixedEdits ?? {}) };
      if (value === undefined) delete edits[routineId];
      else edits[routineId] = value;
      return { ...p, fixedEdits: edits };
    },
    database,
  );
}

export async function addExtraFixed(lifeDate: string, title: string, start: number, min: number, source: Plan['source'] = 'night', database: ShioriDB = db) {
  const id = newId();
  await editPlan(lifeDate, source, (p) => ({ ...p, extraFixed: [...(p.extraFixed ?? []), { id, title, start, min }] }), database);
  return id;
}

export async function moveExtraFixed(lifeDate: string, id: string, start: number, min: number, database: ShioriDB = db) {
  await editPlan(lifeDate, 'night', (p) => ({ ...p, extraFixed: (p.extraFixed ?? []).map((x) => (x.id === id ? { ...x, start, min } : x)) }), database);
}

export async function removeExtraFixed(lifeDate: string, id: string, database: ShioriDB = db) {
  await editPlan(lifeDate, 'night', (p) => ({ ...p, extraFixed: (p.extraFixed ?? []).filter((x) => x.id !== id) }), database);
}

/** 休日として扱う（いつもの固定が日曜と同じになる。その日の固定の変更は戻す） */
export async function setHoliday(lifeDate: string, holiday: boolean, source: Plan['source'] = 'night', database: ShioriDB = db) {
  await editPlan(lifeDate, source, (p) => ({ ...p, holiday, fixedEdits: {} }), database);
}

/** 「この計画で明日を迎える」：23時の通知を止める記録と、自動バックアップ */
export async function confirmPlan(lifeDate: string, database: ShioriDB = db): Promise<SavePlanResult> {
  const plan = await editPlan(lifeDate, 'night', (p) => p, database);
  return afterPlanSaved(plan, database);
}

// ---- いつもの固定（設定） ----

export async function addRoutine(input: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'>, database: ShioriDB = db) {
  const r: Routine = { id: newId(), createdAt: nowIso(), ...input };
  await database.routines.add(r);
  return r;
}

export async function updateRoutine(id: string, patch: Partial<Omit<Routine, 'id' | 'createdAt'>>, database: ShioriDB = db) {
  const r = await database.routines.get(id);
  if (r) await database.routines.put({ ...r, ...patch });
}

export async function deleteRoutine(id: string, database: ShioriDB = db) {
  await database.routines.delete(id);
}

// ---- 表示（端末ごと） ----

export async function getCalendarView(database: ShioriDB = db) {
  return (await getMeta(database)).calendarView ?? { start: 6, end: 24, focus: 8 };
}

export async function setCalendarView(view: { start: number; end: number; focus: number }, database: ShioriDB = db) {
  const start = Math.max(0, Math.min(23, view.start));
  const end = Math.max(start + 1, Math.min(28, view.end));
  const focus = Math.max(start, Math.min(end - 1, view.focus));
  await updateMeta({ calendarView: { start, end, focus } }, database);
}
