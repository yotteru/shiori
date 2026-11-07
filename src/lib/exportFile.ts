import { nowIso, now } from './clock';
import { db, updateMeta, type ShioriDB } from './db';
import { diffDays, lifeDate } from './lifeDate';
import { parseBackupFile, takeSnapshot, toBackupFile, type BackupFile } from './snapshot';
import { toDate } from './clock';

// Google ドライブへの書き出し（手動、指示書 §4.2）

export const EXPORT_REMIND_DAYS = 7;

/** shiori-backup-YYYYMMDD-HHmm.json（JST） */
export function exportFileName(at: Date): string {
  const w = new Date(at.getTime() + 9 * 3600_000).toISOString();
  return `shiori-backup-${w.slice(0, 4)}${w.slice(5, 7)}${w.slice(8, 10)}-${w.slice(11, 13)}${w.slice(14, 16)}.json`;
}

export async function buildExport(database: ShioriDB = db): Promise<{ name: string; json: string }> {
  const file = toBackupFile(await takeSnapshot(database), nowIso());
  return { name: exportFileName(now()), json: JSON.stringify(file, null, 2) };
}

/** 最後の書き出しから7日以上（一度も書き出していない場合も含む） */
export function shouldRemindExport(lastExportAt: string | undefined, at: Date): boolean {
  if (!lastExportAt) return true;
  return diffDays(lifeDate(toDate(lastExportAt)), lifeDate(at)) >= EXPORT_REMIND_DAYS;
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** 共有メニュー（Web Share API）で出す。使えない環境ではダウンロードにする */
export async function shareOrDownload(name: string, json: string): Promise<ShareOutcome> {
  const file = new File([json], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // 共有に失敗したらダウンロードへ
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** 書き出して、成功したら Meta.lastExportAt を更新する */
export async function exportNow(database: ShioriDB = db): Promise<ShareOutcome> {
  const { name, json } = await buildExport(database);
  const outcome = await shareOrDownload(name, json);
  if (outcome !== 'cancelled') await updateMeta({ lastExportAt: nowIso() }, database);
  return outcome;
}

export async function readBackupFile(file: File): Promise<BackupFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return parseBackupFile(null);
  }
  return parseBackupFile(raw);
}
