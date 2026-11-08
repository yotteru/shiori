import Dexie, { type Table } from 'dexie';
import { realNowIso, setDebugNow } from './clock';
import { KIND_BY_TABLE, recordKey, stampPlanItems, type SyncKind } from './syncCore';
import {
  SCHEMA_VERSION,
  type Draft,
  type Journal,
  type Leftover,
  type Meta,
  type Plan,
  type Routine,
  type StartSession,
  type Step,
  type Track,
} from './types';

/** 同期で送る必要がある変更（端末ごと）。key = 'kind:id' */
export interface OutboxEntry {
  key: string;
  kind: SyncKind;
  id: string;
  /** 変更した実時刻。削除のときはこれがサーバーでの比較に使われる */
  at: string;
  deleted: boolean;
}

/** サーバーから来た変更を書くときの印。この印がある書き込みは送り返さない */
export const REMOTE = '__remote';
const remoteDeletes = new Set<string>();
/** サーバーから来た削除を、送り返さずに消すための登録 */
export function markRemoteDelete(table: string, id: string) {
  remoteDeletes.add(`${table}:${id}`);
}

/** 同期の予約（変更を書いたら呼ばれる）。syncEngine が差し替える */
let onLocalChange: () => void = () => {};
export function setOnLocalChange(fn: () => void) {
  onLocalChange = fn;
}

export interface BackupKeyRecord {
  id: 'backup-key';
  key: CryptoKey;
  /** base64 */
  salt: string;
  createdAt: string;
}

// 端末内のデータ（正本）。指示書 §1・§2.2
export class ShioriDB extends Dexie {
  tracks!: Table<Track, string>;
  steps!: Table<Step, string>;
  plans!: Table<Plan, string>;
  journals!: Table<Journal, string>;
  leftovers!: Table<Leftover, string>;
  meta!: Table<Meta, string>;
  drafts!: Table<Draft, string>;
  /** バックアップ用の鍵（取り出し不可の CryptoKey）と salt。合言葉そのものは保存しない */
  secrets!: Table<BackupKeyRecord, string>;
  /** 同期で送る必要がある変更 */
  outbox!: Table<OutboxEntry, string>;
  /** いつもの固定（同期する） */
  routines!: Table<Routine, string>;
  /** 始めた記録（同期する） */
  starts!: Table<StartSession, string>;

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
    // IndexedDB の器の版（データ形式の schemaVersion とは別）
    this.version(2).stores({ secrets: 'id' });
    this.version(3).stores({ outbox: 'key' });
    this.version(4).stores({ routines: 'id' });
    this.version(5).stores({ starts: 'id, lifeDate' });
    installSyncMiddleware(this);
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

/**
 * 同期の下ごしらえ（Dexie のミドルウェア）。
 * 端末での書き込みには実時刻の updatedAt を付け、送る必要がある変更を outbox に残す。
 * サーバーから来た書き込み（REMOTE の印つき・markRemoteDelete 済み）は送り返さない
 */
function installSyncMiddleware(database: ShioriDB) {
  database.use({
    stack: 'dbcore',
    name: 'shiori-sync',
    create(down) {
      return {
        ...down,
        table(tableName) {
          const table = down.table(tableName);
          const kind = KIND_BY_TABLE[tableName];
          if (!kind) return table;
          const pk = table.schema.primaryKey;
          const keyOf = (v: unknown) => String(pk.extractKey!(v));
          return {
            ...table,
            async mutate(req) {
              const changed: OutboxEntry[] = [];
              const at = realNowIso();
              if (req.type === 'add' || req.type === 'put') {
                const keys = req.values.map(keyOf);
                const olds = kind === 'plan' ? await table.getMany({ trans: req.trans, keys }) : [];
                const values = req.values.map((v, i) => {
                  const obj = { ...(v as Record<string, unknown>) };
                  if (obj[REMOTE]) {
                    delete obj[REMOTE];
                    return obj;
                  }
                  let next: Record<string, unknown> = { ...obj, updatedAt: at };
                  if (kind === 'plan') next = stampPlanItems(olds[i], next as never, at) as never;
                  changed.push({ key: recordKey(kind, keys[i]), kind, id: keys[i], at, deleted: false });
                  return next;
                });
                req = { ...req, values };
              } else if (req.type === 'delete') {
                for (const k of req.keys) {
                  const id = String(k);
                  if (remoteDeletes.delete(`${tableName}:${id}`)) continue;
                  changed.push({ key: recordKey(kind, id), kind, id, at, deleted: true });
                }
              } else if (req.type === 'deleteRange') {
                // clear() など。消える行をすべて削除として記録する
                const keys = await table.query({ trans: req.trans, values: false, query: { index: pk, range: req.range } });
                for (const k of keys.result) {
                  const id = String(k);
                  changed.push({ key: recordKey(kind, id), kind, id, at, deleted: true });
                }
              }
              const res = await table.mutate(req);
              if (changed.length) {
                const trans = req.trans as unknown as IDBTransaction;
                const write = () => {
                  database.outbox.bulkPut(changed).then(() => onLocalChange(), () => {});
                };
                if (typeof trans.addEventListener === 'function') trans.addEventListener('complete', write);
                else write();
              }
              return res;
            },
          };
        },
      };
    },
  });
}
