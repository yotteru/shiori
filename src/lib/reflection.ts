import { createTrack } from './actions';
import { nowIso } from './clock';
import { db, type ShioriDB } from './db';
import { newId } from './id';
import { addDays, weekStartMonday } from './lifeDate';
import type { ChangeNote, Journal, Measure, Plan, Track } from './types';

// ふりかえり・変化メモ・数値型・夜の計画の継続（2026-11-09。要件メモ「振り返りと続ける工夫」）

export const NOTE_MAX_LENGTH = 200;

// ---- 1行ジャーナルの一覧（ふりかえり） ----

export interface TimelineDay {
  date: string;
  journal?: string;
  done: { trackId: string; title: string; feel?: 1 | 2 | 3 }[];
  changes: ChangeNote[];
  measures: Measure[];
}
export interface TimelineWeek {
  monday: string;
  days: TimelineDay[];
}

/** 新しい順・週ごと。何もない日は出さない。weeks = 今週から何週ぶん */
export function timeline(
  input: { journals: Journal[]; plans: Plan[]; changes: ChangeNote[]; measures: Measure[] },
  today: string,
  weeks = 4,
): TimelineWeek[] {
  const thisMonday = weekStartMonday(today);
  const out: TimelineWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(thisMonday, -7 * w);
    const days: TimelineDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = addDays(monday, i);
      if (date > today) continue;
      const journal = input.journals.find((j) => j.lifeDate === date)?.text.trim() || undefined;
      const plan = input.plans.find((p) => p.lifeDate === date);
      const done = (plan?.items ?? []).filter((it) => it.status === 'done').map((it) => ({ trackId: it.trackId, title: it.title, ...(it.feel ? { feel: it.feel } : {}) }));
      const changes = input.changes.filter((c) => c.lifeDate === date);
      const measures = input.measures.filter((m) => m.lifeDate === date);
      if (journal || done.length || changes.length || measures.length) days.push({ date, journal, done, changes, measures });
    }
    out.push({ monday, days });
  }
  return out;
}

// ---- 習慣型の手応え（7マスの色の濃さ） ----

/** 取り組みごと・7日ぶんの手応え（その日の最も高いもの） */
export function weekFeel(plans: Plan[], dates: string[]): Record<string, (1 | 2 | 3 | undefined)[]> {
  const out: Record<string, (1 | 2 | 3 | undefined)[]> = {};
  dates.forEach((d, i) => {
    const p = plans.find((x) => x.lifeDate === d);
    for (const it of p?.items ?? []) {
      if (it.status !== 'done' || !it.feel) continue;
      const row = (out[it.trackId] ??= Array(7).fill(undefined));
      row[i] = Math.max(row[i] ?? 0, it.feel) as 1 | 2 | 3;
    }
  });
  return out;
}

// ---- 夜の計画の継続 ----

/** その日の計画を前の晩に組んだか（source が night で、行き先が1つ以上） */
export function plannedNights(plans: Plan[], dates: string[]): boolean[] {
  return dates.map((d) => {
    const p = plans.find((x) => x.lifeDate === d);
    return !!p && p.source === 'night' && p.items.length > 0;
  });
}

// ---- 数値型 ----

/** 期間の記録（日ごとに最後に測った値）。古い順 */
export function measureSeries(measures: Measure[], trackId: string, from: string, to: string): { date: string; value: number }[] {
  const byDate = new Map<string, Measure>();
  for (const m of measures) {
    if (m.trackId !== trackId || m.lifeDate < from || m.lifeDate > to) continue;
    const cur = byDate.get(m.lifeDate);
    if (!cur || m.at > cur.at) byDate.set(m.lifeDate, m);
  }
  return [...byDate.values()].sort((a, b) => a.lifeDate.localeCompare(b.lifeDate)).map((m) => ({ date: m.lifeDate, value: m.value }));
}

export function parseMeasure(text: string): number | null {
  const t = text.trim().replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// ---- 書き込み ----

export async function addChange(trackId: string, text: string, lifeDate: string, database: ShioriDB = db): Promise<ChangeNote | undefined> {
  const t = text.trim().slice(0, NOTE_MAX_LENGTH);
  if (!t) return undefined;
  const c: ChangeNote = { id: newId(), trackId, lifeDate, text: t, createdAt: nowIso() };
  await database.changes.add(c);
  return c;
}

export async function deleteChange(id: string, database: ShioriDB = db) {
  await database.changes.delete(id);
}

export async function addMeasure(trackId: string, value: number, lifeDate: string, database: ShioriDB = db): Promise<Measure> {
  const m: Measure = { id: newId(), trackId, lifeDate, value, at: nowIso() };
  await database.measures.add(m);
  return m;
}

export async function deleteMeasure(id: string, database: ShioriDB = db) {
  await database.measures.delete(id);
}

export async function createNumberTrack(input: { name: string; unit?: string; target?: number }, database: ShioriDB = db): Promise<Track> {
  const unit = input.unit?.trim();
  return createTrack({ name: input.name.trim(), type: 'number', ...(unit ? { unit } : {}), ...(input.target !== undefined ? { target: input.target } : {}) }, [], database);
}
