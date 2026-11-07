import { realNowIso } from './clock';
import { decryptText, deriveKey, encryptText, fromBase64 } from './crypto';
import { db, getMeta, markRemoteDelete, REMOTE, updateMeta, type ShioriDB } from './db';
import { decideApply, KIND_BY_TABLE, recordKey, TABLE_BY_KIND, type SyncKind, type SyncRecord } from './syncCore';

// 端末間の同期（2026-11-07 追加）。
// 1件ずつ端末内で暗号化してサーバーに置き、項目ごとに後から変えた方を残す。
// 開いた時・戻ってきた時に取り込み、変更したらすぐ送る

export interface RemoteRow {
  kind: SyncKind;
  record_id: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  client_updated_at: string;
  server_updated_at: string;
}
export type OutgoingRow = Omit<RemoteRow, 'server_updated_at'>;

export interface SyncKeys {
  salt: string;
  check_ciphertext: string;
  check_iv: string;
}

/** サーバーとのやり取り（本番は Supabase、テストではメモリ上の偽物） */
export interface SyncServer {
  getKeys(): Promise<SyncKeys | null>;
  putKeys(keys: SyncKeys): Promise<void>;
  /** 送る。サーバーの方が新しくて受け付けなかった行を返す（同じ時刻なら上書き＝合言葉の変更で送り直せる） */
  push(rows: OutgoingRow[]): Promise<RemoteRow[]>;
  /** since より後に変わった行を古い順に */
  pull(since: string | null, limit: number): Promise<RemoteRow[]>;
}

const CHECK_TEXT = 'shiori-sync-check';
const EPOCH = '1970-01-01T00:00:00.000Z';
const PULL_LIMIT = 500;
const PUSH_CHUNK = 200;
/** サーバー時刻のずれで取りこぼさないよう、少し前から取り込み直す（同じ行の再適用は無害） */
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'needs-passphrase' | 'no-key';
export interface SyncStatus {
  state: SyncState;
  lastSyncAt?: string;
}

let status: SyncStatus = { state: 'off' };
const listeners = new Set<(s: SyncStatus) => void>();
function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((fn) => fn(s));
}
export function getSyncStatus(): SyncStatus {
  return status;
}
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const iso = (v: string) => new Date(v).toISOString();

export class SyncPassphraseError extends Error {
  constructor() {
    super('合言葉が違うようです。');
    this.name = 'SyncPassphraseError';
  }
}

async function localKey(database: ShioriDB) {
  return database.secrets.get('backup-key');
}

/** 端末内の全データを「送る必要あり」にする（同期を始めた時・合言葉を変えた時） */
export async function markAllDirty(database: ShioriDB = db): Promise<void> {
  const at = realNowIso();
  const entries = [];
  for (const [table, kind] of Object.entries(KIND_BY_TABLE)) {
    const keys = await database.table(table).toCollection().primaryKeys();
    for (const k of keys) entries.push({ key: recordKey(kind, String(k)), kind, id: String(k), at, deleted: false });
  }
  await database.outbox.bulkPut(entries);
}

/** サーバーに合言葉の確認用データを置く（その端末の鍵で） */
async function uploadKeys(database: ShioriDB, server: SyncServer) {
  const rec = await localKey(database);
  if (!rec) throw new Error('no key');
  const { ciphertext, iv } = await encryptText(rec.key, CHECK_TEXT);
  await server.putKeys({ salt: rec.salt, check_ciphertext: ciphertext, check_iv: iv });
}

/**
 * この端末で同期を始める。
 * - サーバーにまだ鍵がなければ、この端末の合言葉（バックアップと同じ）で始める
 * - すでに別の端末で始めていて合言葉の salt が同じなら、そのまま加わる
 * - 違えば 'needs-passphrase'（joinSync で合言葉を入れる）
 */
export async function enableSync(server: SyncServer, database: ShioriDB = db): Promise<'ok' | 'no-key' | 'needs-passphrase'> {
  const rec = await localKey(database);
  if (!rec) return 'no-key';
  const keys = await server.getKeys();
  if (keys && keys.salt !== rec.salt) return 'needs-passphrase';
  if (!keys) await uploadKeys(database, server);
  await updateMeta({ syncEnabled: true, syncCursor: undefined }, database);
  await markAllDirty(database);
  await syncNow(server, database);
  return 'ok';
}

/** 別の端末で始めた同期に、合言葉を入れて加わる */
export async function joinSync(server: SyncServer, passphrase: string, database: ShioriDB = db): Promise<void> {
  const keys = await server.getKeys();
  if (!keys) throw new Error('まだどの端末でも同期を始めていません。');
  const key = await deriveKey(passphrase, fromBase64(keys.salt));
  try {
    if ((await decryptText(key, keys.check_ciphertext, keys.check_iv)) !== CHECK_TEXT) throw new Error();
  } catch {
    throw new SyncPassphraseError();
  }
  await database.secrets.put({ id: 'backup-key', key, salt: keys.salt, createdAt: realNowIso() });
  await updateMeta({ syncEnabled: true, syncCursor: undefined }, database);
  await markAllDirty(database);
  await syncNow(server, database);
}

/** 合言葉を変えたとき：サーバーの鍵を差し替え、全件を新しい鍵で送り直す */
export async function rekeySync(server: SyncServer, database: ShioriDB = db): Promise<void> {
  const meta = await getMeta(database);
  if (!meta.syncEnabled) return;
  await uploadKeys(database, server);
  await markAllDirty(database);
  await syncNow(server, database);
}

export async function disableSync(database: ShioriDB = db): Promise<void> {
  await updateMeta({ syncEnabled: false, syncCursor: undefined }, database);
  await database.outbox.clear();
  setStatus({ state: 'off' });
}

async function applyRow(database: ShioriDB, key: CryptoKey, row: RemoteRow): Promise<void> {
  const tableName = TABLE_BY_KIND[row.kind];
  if (!tableName) return;
  const table = database.table(tableName);
  const local = (await table.get(row.record_id)) as SyncRecord | undefined;
  const updatedAt = iso(row.client_updated_at);
  let value: SyncRecord | undefined;
  if (!row.deleted) {
    try {
      value = JSON.parse(await decryptText(key, row.ciphertext, row.iv)) as SyncRecord;
    } catch {
      return; // 開けない行（合言葉を変える前の古い行など）は飛ばす。中身は記録に残さない
    }
  }
  const d = decideApply(row.kind, local, { deleted: row.deleted, updatedAt, value });
  if (d.action === 'keep-local') return;
  if (d.action === 'delete') {
    markRemoteDelete(tableName, row.record_id);
    await table.delete(row.record_id);
    return;
  }
  const put = d.pushBack ? { ...d.value, updatedAt: realNowIso() } : d.value;
  await table.put({ ...put, [REMOTE]: true });
  if (d.pushBack) {
    await database.outbox.put({
      key: recordKey(row.kind, row.record_id),
      kind: row.kind,
      id: row.record_id,
      at: (put as { updatedAt: string }).updatedAt,
      deleted: false,
    });
  }
}

async function pullAll(database: ShioriDB, server: SyncServer, key: CryptoKey) {
  const meta = await getMeta(database);
  let since = meta.syncCursor ? new Date(new Date(meta.syncCursor).getTime() - CURSOR_OVERLAP_MS).toISOString() : null;
  let cursor = meta.syncCursor;
  for (;;) {
    const rows = await server.pull(since, PULL_LIMIT);
    for (const row of rows) {
      await applyRow(database, key, row);
      const t = iso(row.server_updated_at);
      if (!cursor || t > cursor) cursor = t;
    }
    if (rows.length < PULL_LIMIT) break;
    since = iso(rows[rows.length - 1].server_updated_at);
  }
  if (cursor) await updateMeta({ syncCursor: cursor }, database);
}

async function pushAll(database: ShioriDB, server: SyncServer, key: CryptoKey) {
  const entries = await database.outbox.toArray();
  for (let i = 0; i < entries.length; i += PUSH_CHUNK) {
    const chunk = entries.slice(i, i + PUSH_CHUNK);
    const rows: OutgoingRow[] = [];
    for (const e of chunk) {
      const record = e.deleted ? undefined : ((await database.table(TABLE_BY_KIND[e.kind]).get(e.id)) as SyncRecord | undefined);
      const deleted = !record;
      const { ciphertext, iv } = await encryptText(key, deleted ? 'null' : JSON.stringify(record));
      rows.push({
        kind: e.kind,
        record_id: e.id,
        ciphertext,
        iv,
        deleted,
        // 同期を入れる前からあるデータは updatedAt がないので、いちばん古い扱いにする
        client_updated_at: deleted ? e.at : ((record as { updatedAt?: string }).updatedAt ?? EPOCH),
      });
    }
    const rejected = await server.push(rows);
    // 送っている間に変わったものは残して次回送る
    await database.transaction('rw', database.outbox, async () => {
      for (const e of chunk) {
        const now = await database.outbox.get(e.key);
        if (now && now.at === e.at && now.deleted === e.deleted) await database.outbox.delete(e.key);
      }
    });
    for (const r of rejected) await applyRow(database, key, r);
  }
}

let running: Promise<SyncState> | null = null;
let again = false;

/** 取り込み → 送信。同時に1つだけ走り、走っている間に頼まれたらもう1回 */
export function syncNow(server: SyncServer, database: ShioriDB = db): Promise<SyncState> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result: SyncState = 'idle';
    do {
      again = false;
      result = await runOnce(server, database);
    } while (again && result === 'idle');
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function runOnce(server: SyncServer, database: ShioriDB): Promise<SyncState> {
  const meta = await getMeta(database);
  if (!meta.syncEnabled) {
    setStatus({ state: 'off' });
    return 'off';
  }
  const rec = await localKey(database);
  if (!rec) {
    setStatus({ state: 'no-key', lastSyncAt: meta.lastSyncAt });
    return 'no-key';
  }
  setStatus({ state: 'syncing', lastSyncAt: meta.lastSyncAt });
  try {
    const keys = await server.getKeys();
    if (!keys || keys.salt !== rec.salt) {
      setStatus({ state: 'needs-passphrase', lastSyncAt: meta.lastSyncAt });
      return 'needs-passphrase';
    }
    await pullAll(database, server, rec.key);
    await pushAll(database, server, rec.key);
    // 2台目の端末：取り込んだ取り組みがあれば初回案内を飛ばす
    const after = await getMeta(database);
    const lastSyncAt = realNowIso();
    await updateMeta({ lastSyncAt, onboarded: after.onboarded || (await database.tracks.count()) > 0 }, database);
    setStatus({ state: 'idle', lastSyncAt });
    return 'idle';
  } catch {
    setStatus({ state: 'error', lastSyncAt: meta.lastSyncAt });
    return 'error';
  }
}
