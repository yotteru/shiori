import { afterPlanSaved, itemFromCandidate, lastWindow, type SavePlanResult } from './actions';
import type { Candidate } from './candidates';
import { findGaps, fixedBlocksFor, MIN_LEN, withStarts, type Gap } from './calendar';
import { nowIso } from './clock';
import { db, getMeta, updateMeta, type ShioriDB } from './db';
import { newId } from './id';
import { weekday } from './lifeDate';
import { withGapLabel } from './gaps';
import type { GapLabel, Plan, PlanItem, Routine } from './types';

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
  await editStart(lifeDate, itemId, { firstStep }, database);
}

/** 始め方（きっかけ・最初の一手）を書き換える */
export async function editStart(lifeDate: string, itemId: string, patch: { firstStep?: string; cue?: string }, database: ShioriDB = db) {
  await editPlan(
    lifeDate,
    'night',
    (p) => ({
      ...p,
      items: p.items.map((i) => {
        if (i.id !== itemId) return i;
        const next = { ...i, ...patch };
        if (!next.cue) delete next.cue;
        return next;
      }),
    }),
    database,
  );
}

/** 前の晩の準備を書く・済ませる（text が空なら消す） */
export async function setPrep(lifeDate: string, prep: { text: string; doneAt?: string } | null, database: ShioriDB = db) {
  await editPlan(
    lifeDate,
    'night',
    (p) => {
      const next = { ...p };
      if (prep && prep.text.trim()) next.prep = { text: prep.text.trim(), ...(prep.doneAt ? { doneAt: prep.doneAt } : {}) };
      else delete next.prep;
      return next;
    },
    database,
  );
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

/** 終日の予定（出張など）を足す */
export async function addAllDayFixed(lifeDate: string, title: string, database: ShioriDB = db) {
  const id = newId();
  await editPlan(lifeDate, 'night', (p) => ({ ...p, extraFixed: [...(p.extraFixed ?? []), { id, title, start: 0, min: 1440, allDay: true }] }), database);
  return id;
}

/** この日にやることの札を付ける・外す（週の見通し。時刻は決めない） */
export async function toggleIntent(lifeDate: string, trackId: string, database: ShioriDB = db) {
  await editPlan(
    lifeDate,
    'night',
    (p) => {
      const cur = p.intents ?? [];
      const next = cur.includes(trackId) ? cur.filter((x) => x !== trackId) : [...cur, trackId];
      const out: Plan = { ...p, intents: next };
      if (!next.length) delete out.intents;
      return out;
    },
    database,
  );
}

/**
 * 「札のぶんを置く」（2026-11-09）：その日に札を付けた取り組みのうち、まだ置いていないものを空きに仮に置く。
 * 平日は 18:00 以降、休日は 9:00 以降の空きから順に入れ、入らなければ表示の時間帯のどこかの空きに入れる。置けた数を返す
 */
export async function placeIntents(
  lifeDate: string,
  candidates: Candidate[],
  routines: Routine[],
  view: { start: number; end: number },
  database: ShioriDB = db,
): Promise<number> {
  let placed = 0;
  await database.transaction('rw', database.plans, database.leftovers, async () => {
    const plan = await ensurePlan(database, lifeDate, 'night');
    const intents = plan.intents ?? [];
    const have = new Set(plan.items.map((i) => i.trackId));
    const items = [...plan.items];
    const holiday = plan.holiday || [0, 6].includes(weekday(lifeDate));
    const prefer = (holiday ? 9 : 18) * 60;
    for (const trackId of intents) {
      if (have.has(trackId)) continue;
      const c = candidates.find((x) => x.trackId === trackId);
      if (!c) continue;
      const len = Math.max(MIN_LEN, c.minutes);
      const blocks = [...fixedBlocksFor(lifeDate, routines, { ...plan, items }), ...items.map((i) => ({ start: i.start ?? 0, min: i.minutes }))];
      const gaps = findGaps(blocks, { minLen: len, from: view.start * 60, to: view.end * 60 });
      // 好みの時刻以降に入る空き → なければ最初の空き
      let start: number | null = null;
      for (const g of gaps) {
        const s = Math.max(g.start, prefer);
        if (s + len <= g.start + g.len) {
          start = s;
          break;
        }
      }
      if (start === null) start = gaps[0]?.start ?? null;
      if (start === null) continue;
      items.push({ ...itemFromCandidate(c), start, minutes: len });
      have.add(trackId);
      placed++;
    }
    if (placed) await database.plans.put({ ...plan, items });
  });
  return placed;
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

/** 空いていた時間に印を付ける・外す（振り返りから。任意。2026-11-10） */
export async function setGapLabel(lifeDate: string, gap: Gap, label: GapLabel | undefined, source: Plan['source'] = 'morning-quick', database: ShioriDB = db) {
  await editPlan(lifeDate, source, (p) => ({ ...p, gapLabels: withGapLabel(p.gapLabels, gap, label) }), database);
}
