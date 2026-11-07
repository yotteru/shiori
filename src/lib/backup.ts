import { nowIso } from './clock';
import { deriveKey, decryptText, encryptText, fromBase64, randomBytes, SALT_BYTES, toBase64 } from './crypto';
import { db, updateMeta, type ShioriDB } from './db';
import { parseBackupFile, replaceAll, takeSnapshot, toBackupFile } from './snapshot';
import { currentUserId, supabase } from './supabase';
import type { SyncResult } from './sync';
import { SCHEMA_VERSION } from './types';

// 自動バックアップ（指示書 §4.1）。端末内で暗号化してから Supabase に送る

export const KEEP_GENERATIONS = 7;

export async function hasBackupKey(database: ShioriDB = db): Promise<boolean> {
  return !!(await database.secrets.get('backup-key'));
}

/** 合言葉を設定・変更する。新しい salt で鍵を作り直し、端末に保存する */
export async function setPassphrase(passphrase: string, database: ShioriDB = db): Promise<void> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt);
  await database.secrets.put({ id: 'backup-key', key, salt: toBase64(salt), createdAt: nowIso() });
}

/** 暗号化したバックアップの行（送る中身） */
export async function buildEncryptedBackup(database: ShioriDB = db) {
  const rec = await database.secrets.get('backup-key');
  if (!rec) return null;
  const json = JSON.stringify(toBackupFile(await takeSnapshot(database), nowIso()));
  const { ciphertext, iv } = await encryptText(rec.key, json);
  return { ciphertext, iv, salt: rec.salt, schema_version: SCHEMA_VERSION };
}

/** バックアップを1世代送り、最新7世代より古いものを消す */
export async function runBackup(database: ShioriDB = db): Promise<SyncResult> {
  if (!supabase) return 'skipped';
  const row = await buildEncryptedBackup(database);
  if (!row) return 'skipped';
  const userId = await currentUserId();
  if (!userId) return 'failed';
  try {
    const { error } = await supabase.from('encrypted_backups').insert({ user_id: userId, ...row });
    if (error) throw new Error(error.code ?? 'insert failed');
    const { data: old, error: listError } = await supabase
      .from('encrypted_backups')
      .select('id')
      .order('created_at', { ascending: false })
      .range(KEEP_GENERATIONS, KEEP_GENERATIONS + 100);
    if (!listError && old?.length) {
      await supabase.from('encrypted_backups').delete().in('id', old.map((r) => r.id));
    }
    await updateMeta({ lastBackupAt: nowIso() }, database);
    return 'ok';
  } catch {
    return 'failed';
  }
}

export interface EncryptedBackupRow {
  ciphertext: string;
  iv: string;
  salt: string;
  schema_version: number;
  created_at?: string;
}

/**
 * 暗号化された行を合言葉で開いて端末内のデータを置き換える。
 * 合言葉が違えば DecryptError を投げ、端末内のデータには触れない
 */
export async function restoreFromRow(row: EncryptedBackupRow, passphrase: string, database: ShioriDB = db): Promise<void> {
  const salt = fromBase64(row.salt);
  const key = await deriveKey(passphrase, salt);
  const json = await decryptText(key, row.ciphertext, row.iv);
  const file = parseBackupFile(JSON.parse(json));
  await replaceAll(file, database);
  // 同じ合言葉で次回からもバックアップできるよう鍵を保存する
  await database.secrets.put({ id: 'backup-key', key, salt: row.salt, createdAt: nowIso() });
}

export async function fetchLatestBackup(): Promise<EncryptedBackupRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('encrypted_backups')
    .select('ciphertext, iv, salt, schema_version, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error('バックアップを取得できませんでした。');
  return (data?.[0] as EncryptedBackupRow | undefined) ?? null;
}
