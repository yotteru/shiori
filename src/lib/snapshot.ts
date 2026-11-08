import { db, type ShioriDB } from './db';
import { SCHEMA_VERSION, type Journal, type Leftover, type Memo, type Plan, type Routine, type StartSession, type Step, type Track } from './types';

// 全データの取り出しと置き換え。書き出し（§4.2）と自動バックアップ（§4.1）で共通に使う

export interface Snapshot {
  tracks: Track[];
  steps: Step[];
  plans: Plan[];
  journals: Journal[];
  leftovers: Leftover[];
  /** いつもの固定（2026-11-08 追加。古いファイルにはない） */
  routines?: Routine[];
  /** 始めた記録（2026-11-08 追加。古いファイルにはない） */
  starts?: StartSession[];
  /** メモ箱（2026-11-08 追加。古いファイルにはない） */
  memos?: Memo[];
}

export interface BackupFile extends Snapshot {
  format: 'shiori-backup';
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
}

export async function takeSnapshot(database: ShioriDB = db): Promise<Snapshot> {
  return database.transaction('r', [database.tracks, database.steps, database.plans, database.journals, database.leftovers, database.routines, database.starts, database.memos], async () => ({
    tracks: await database.tracks.toArray(),
    steps: await database.steps.toArray(),
    plans: await database.plans.orderBy('lifeDate').toArray(),
    journals: await database.journals.orderBy('lifeDate').toArray(),
    leftovers: await database.leftovers.toArray(),
    routines: await database.routines.toArray(),
    starts: await database.starts.toArray(),
    memos: await database.memos.toArray(),
  }));
}

export function toBackupFile(s: Snapshot, exportedAt: string): BackupFile {
  return { format: 'shiori-backup', schemaVersion: SCHEMA_VERSION, exportedAt, ...s };
}

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

/** 形式と版番号を検証する。違えば InvalidBackupError */
export function parseBackupFile(raw: unknown): BackupFile {
  if (!raw || typeof raw !== 'object') throw new InvalidBackupError('しおりのバックアップファイルではありません。');
  const o = raw as Record<string, unknown>;
  if (o.format !== 'shiori-backup') throw new InvalidBackupError('しおりのバックアップファイルではありません。');
  if (o.schemaVersion !== SCHEMA_VERSION) {
    throw new InvalidBackupError(`このファイルの版（${String(o.schemaVersion)}）には対応していません。対応している版は ${SCHEMA_VERSION} です。`);
  }
  for (const k of ['tracks', 'steps', 'plans', 'journals', 'leftovers'] as const) {
    if (!isArr(o[k])) throw new InvalidBackupError('ファイルの中身が欠けています。');
  }
  const tracks = o.tracks as Track[];
  if (!tracks.every((t) => t && typeof t.id === 'string' && typeof t.name === 'string')) {
    throw new InvalidBackupError('ファイルの中身が壊れています。');
  }
  const plans = o.plans as Plan[];
  if (!plans.every((p) => p && typeof p.lifeDate === 'string' && isArr(p.items))) {
    throw new InvalidBackupError('ファイルの中身が壊れています。');
  }
  return raw as BackupFile;
}

/** 端末内のデータを丸ごと置き換える（下書きは消す。Meta は onboarded だけ立てる） */
export async function replaceAll(s: Snapshot, database: ShioriDB = db): Promise<void> {
  await database.transaction(
    'rw',
    [database.tracks, database.steps, database.plans, database.journals, database.leftovers, database.routines, database.starts, database.memos, database.drafts, database.meta],
    async () => {
      await Promise.all([
        database.tracks.clear(),
        database.steps.clear(),
        database.plans.clear(),
        database.journals.clear(),
        database.leftovers.clear(),
        database.routines.clear(),
        database.starts.clear(),
        database.memos.clear(),
        database.drafts.clear(),
      ]);
      await database.tracks.bulkPut(s.tracks);
      await database.steps.bulkPut(s.steps);
      await database.plans.bulkPut(s.plans);
      await database.journals.bulkPut(s.journals);
      await database.leftovers.bulkPut(s.leftovers);
      if (s.routines?.length) await database.routines.bulkPut(s.routines);
      if (s.starts?.length) await database.starts.bulkPut(s.starts);
      if (s.memos?.length) await database.memos.bulkPut(s.memos);
      const meta = (await database.meta.get('meta')) ?? { key: 'meta' as const, schemaVersion: 1 as const, onboarded: false };
      await database.meta.put({ ...meta, onboarded: meta.onboarded || s.tracks.length > 0 });
    },
  );
}
