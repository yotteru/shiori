import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setBackupHook } from './lib/actions';
import { runBackup } from './lib/backup';
import { startSyncRuntime } from './lib/syncRuntime';
import './styles.css';

// 夜の計画保存の3番目：自動バックアップ（§3.4・§4.1）
setBackupHook(() => runBackup());
// iPhone と iPad の同期：開いた時・戻ってきた時・変更を書いた時
startSyncRuntime();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
