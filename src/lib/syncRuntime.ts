import { getMeta, setOnLocalChange } from './db';
import { rekeySync, syncNow, type SyncState } from './syncEngine';
import { supabaseSyncServer } from './syncSupabase';

// アプリ実行中の同期のきっかけ：開いた時・戻ってきた時・変更を書いた時

let timer: number | null = null;

export function scheduleSync(delayMs = 1500): void {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void runSync();
  }, delayMs);
}

export async function runSync(): Promise<SyncState> {
  const server = supabaseSyncServer();
  if (!server) return 'off';
  if (!(await getMeta()).syncEnabled) return 'off';
  return syncNow(server);
}

/** 合言葉を設定・変更した後に呼ぶ。同期中なら新しい鍵で全件を送り直す */
export async function afterPassphraseChanged(): Promise<void> {
  const server = supabaseSyncServer();
  if (server) await rekeySync(server);
}

export function startSyncRuntime(): void {
  setOnLocalChange(() => scheduleSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  });
  window.addEventListener('online', () => scheduleSync(0));
}
