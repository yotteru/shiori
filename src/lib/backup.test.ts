import { describe, expect, it } from 'vitest';
import { buildEncryptedBackup, hasBackupKey, restoreFromRow, setPassphrase } from './backup';
import { DecryptError, decryptText, deriveKey, encryptText, fromBase64, randomBytes } from './crypto';
import { ShioriDB } from './db';
import { exportFileName, shouldRemindExport } from './exportFile';
import { InvalidBackupError, parseBackupFile, replaceAll, takeSnapshot, toBackupFile } from './snapshot';

// 読み込んだデータには同期用の updatedAt（実時刻）が付き直すので、それ以外を比べる
const strip = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (k, x) => (k === 'updatedAt' ? undefined : x)));

let n = 0;
const fresh = () => new ShioriDB(`backup-${n++}`);

async function seed(d: ShioriDB) {
  await d.tracks.put({ id: 't', name: '筋トレ', type: 'habit', createdAt: '2026-10-01T00:00:00Z', lastNote: { text: '脚の日', at: '2026-11-03T12:00:00Z' } });
  await d.steps.put({ id: 's', trackId: 'p', order: 1, title: '検証', minutes: 45, firstStep: '', status: 'todo' });
  await d.plans.put({
    lifeDate: '2026-11-04',
    window: { start: '19:00', end: '22:30' },
    createdAt: '2026-11-03T14:00:00Z',
    source: 'night',
    items: [{ id: 'i', trackId: 't', title: '筋トレ', minutes: 90, firstStep: '', status: 'done', doneAt: '2026-11-04T11:00:00Z', nextNote: '脚の日' }],
  });
  await d.journals.put({ lifeDate: '2026-11-04', text: '日記：秘密の内容', updatedAt: '2026-11-04T14:00:00Z' });
  await d.leftovers.put({ id: 'L', fromLifeDate: '2026-11-03', item: { id: 'x', trackId: 't', title: 't', minutes: 30, firstStep: '', status: 'undone' } });
}

describe('暗号化（受け入れテスト 5）', () => {
  it('暗号化 → 復号の往復で同じデータに戻る', async () => {
    const salt = randomBytes(16);
    const key = await deriveKey('正しい合言葉', salt);
    const { ciphertext, iv } = await encryptText(key, '日記：秘密の内容');
    expect(ciphertext).not.toContain('秘密');
    expect(fromBase64(iv)).toHaveLength(12);
    expect(await decryptText(key, ciphertext, iv)).toBe('日記：秘密の内容');
  });

  it('合言葉が違うと復号に失敗し、端末内のデータを壊さない', async () => {
    const src = fresh();
    await seed(src);
    await setPassphrase('正しい合言葉', src);
    expect(await hasBackupKey(src)).toBe(true);
    const row = await buildEncryptedBackup(src);
    expect(row).not.toBeNull();
    expect(row!.ciphertext).not.toContain('秘密');
    expect(fromBase64(row!.salt)).toHaveLength(16);

    const dst = fresh();
    await dst.tracks.put({ id: 'keep', name: '残すべきデータ', type: 'habit', createdAt: '2026-11-01T00:00:00Z' });
    await expect(restoreFromRow(row!, '違う合言葉', dst)).rejects.toBeInstanceOf(DecryptError);
    expect((await dst.tracks.toArray()).map((t) => t.id)).toEqual(['keep']);

    await restoreFromRow(row!, '正しい合言葉', dst);
    const a = await takeSnapshot(src);
    const b = await takeSnapshot(dst);
    expect(strip(b)).toEqual(strip(a));
    expect(await hasBackupKey(dst)).toBe(true);
  });
});

describe('書き出しと読み込み（受け入れテスト 6）', () => {
  it('書き出し → 読み込みの往復で同じデータに戻る', async () => {
    const src = fresh();
    await seed(src);
    const json = JSON.stringify(toBackupFile(await takeSnapshot(src), '2026-11-04T14:00:00.000Z'));
    const file = parseBackupFile(JSON.parse(json));
    expect(file.format).toBe('shiori-backup');
    const dst = fresh();
    await dst.tracks.put({ id: 'old', name: '消える', type: 'habit', createdAt: '2026-11-01T00:00:00Z' });
    await replaceAll(file, dst);
    expect(strip(await takeSnapshot(dst))).toEqual(strip(await takeSnapshot(src)));
    expect((await dst.meta.get('meta'))?.onboarded).toBe(true);
  });

  it('版番号や形式が違うファイルは拒否する', () => {
    const ok = toBackupFile({ tracks: [], steps: [], plans: [], journals: [], leftovers: [] }, 'x');
    expect(() => parseBackupFile({ ...ok, schemaVersion: 2 })).toThrow(InvalidBackupError);
    expect(() => parseBackupFile({ ...ok, format: 'other' })).toThrow(InvalidBackupError);
    expect(() => parseBackupFile({ ...ok, plans: undefined })).toThrow(InvalidBackupError);
    expect(() => parseBackupFile(null)).toThrow(InvalidBackupError);
    expect(parseBackupFile(ok)).toEqual(ok);
  });

  it('ファイル名と7日の催促', () => {
    expect(exportFileName(new Date('2026-11-04T14:05:00Z'))).toBe('shiori-backup-20261104-2305.json');
    const at = new Date('2026-11-11T14:00:00Z');
    expect(shouldRemindExport(undefined, at)).toBe(true);
    expect(shouldRemindExport('2026-11-04T14:00:00Z', at)).toBe(true);
    expect(shouldRemindExport('2026-11-05T14:00:00Z', at)).toBe(false);
  });
});
