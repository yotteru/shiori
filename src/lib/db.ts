import Dexie, { type Table } from 'dexie';
import { setDebugNow } from './clock';
import {
  SCHEMA_VERSION,
  type Draft,
  type Journal,
  type Leftover,
  type Meta,
  type Plan,
  type Step,
  type Track,
} from './types';

// 端末内のデータ（正本）。指示書 §1・§2.2
export class ShioriDB extends Dexie {
  tracks!: Table<Track, string>;
  steps!: Table<Step, string>;
  plans!: Table<Plan, string>;
  journals!: Table<Journal, string>;
  leftovers!: Table<Leftover, string>;
  meta!: Table<Meta, string>;
  drafts!: Table<Draft, string>;

  constructor(name = 'shiori') {
    super(name);
    this.version(1).stores({
      tracks: 'id, type, createdAt',
      steps: 'id, trackId, [trackId+order]',
      plans: 'lifeDate',
      journals: 'lifeDate',
      leftovers: 'id, fromLifeDate',
      meta: 'key',
      drafts: 'key',
    });
  }
}

export const db = new ShioriDB();

export function defaultMeta(): Meta {
  return { key: 'meta', schemaVersion: SCHEMA_VERSION, onboarded: false };
}

export async function getMeta(database: ShioriDB = db): Promise<Meta> {
  return (await database.meta.get('meta')) ?? defaultMeta();
}

export async function updateMeta(
  patch: Partial<Omit<Meta, 'key' | 'schemaVersion'>>,
  database: ShioriDB = db,
): Promise<Meta> {
  return database.transaction('rw', database.meta, async () => {
    const next: Meta = { ...(await getMeta(database)), ...patch };
    // undefined を渡した項目は消す（例：debugNow の解除）
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
    }
    await database.meta.put(next);
    return next;
  });
}

/** 起動時に呼ぶ：開発用の日時上書きを時計に反映する */
export async function loadClockOverride(database: ShioriDB = db): Promise<void> {
  const meta = await getMeta(database);
  setDebugNow(meta.debugNow);
}

/** 開発用の日時上書きを設定・解除する（§6） */
export async function saveDebugNow(iso: string | null, database: ShioriDB = db): Promise<void> {
  await updateMeta({ debugNow: iso ?? undefined }, database);
  setDebugNow(iso);
}

/** 端末内のデータが空か（復元の案内を出す判定に使う） */
export async function isLocalDataEmpty(database: ShioriDB = db): Promise<boolean> {
  const counts = await Promise.all([
    database.tracks.count(),
    database.plans.count(),
    database.journals.count(),
  ]);
  return counts.every((c) => c === 0);
}

/** 初回に永続ストレージを要求する（Safari が勝手に消さないように） */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
