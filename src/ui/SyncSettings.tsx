import { useEffect, useState } from 'react';
import { useLive, useNow } from '../hooks';
import { hasBackupKey } from '../lib/backup';
import { toDate } from '../lib/clock';
import { getMeta } from '../lib/db';
import { diffDays, jstTime, lifeDate } from '../lib/lifeDate';
import { disableSync, enableSync, getSyncStatus, joinSync, onSyncStatus, SyncPassphraseError, type SyncStatus } from '../lib/syncEngine';
import { runSync } from '../lib/syncRuntime';
import { supabaseSyncServer } from '../lib/syncSupabase';
import { PassphraseForm } from './Backup';

// iPhone と iPad の同期（2026-11-07 追加）

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(getSyncStatus);
  useEffect(() => onSyncStatus(setS), []);
  return s;
}

function when(iso: string | undefined, today: string): string {
  if (!iso) return 'まだありません';
  const d = diffDays(lifeDate(toDate(iso)), today);
  return d <= 0 ? `今日 ${jstTime(toDate(iso))}` : `${d}日前`;
}

/** 別の端末で始めた同期に、合言葉を入れて加わる */
export function JoinSyncForm({ onDone, submitLabel = 'この端末も同期する' }: { onDone?: () => void; submitLabel?: string }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const server = supabaseSyncServer();
    if (!server) return;
    setBusy(true);
    setMsg('');
    try {
      await joinSync(server, pass);
      setPass('');
      onDone?.();
    } catch (err) {
      setMsg(err instanceof SyncPassphraseError ? '合言葉が違うようです。' : err instanceof Error ? err.message : '同期できませんでした。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>合言葉（もう一方の端末で設定したもの）</span>
        {/* iPad で入力欄をタップすると暗くなる事例への対策として、自動入力の印を付けない */}
        <input
          className="input"
          type="password"
          name="shiori-sync-pass"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
      </label>
      <button className="btn-primary" type="submit" disabled={busy || !pass}>
        {busy ? '同期中…' : submitLabel}
      </button>
      {msg && <span className="error">{msg}</span>}
    </form>
  );
}

export function SyncSettings() {
  const now = useNow();
  const meta = useLive(() => getMeta(), []);
  const hasKey = useLive(() => hasBackupKey(), []);
  const status = useSyncStatus();
  const [mode, setMode] = useState<'idle' | 'set-passphrase' | 'join'>('idle');
  const [busy, setBusy] = useState(false);
  const server = supabaseSyncServer();
  if (!server || !meta || hasKey === undefined) return null;
  const today = lifeDate(now);

  const start = async () => {
    setBusy(true);
    const r = await enableSync(server).catch(() => 'error' as const);
    setBusy(false);
    if (r === 'no-key') setMode('set-passphrase');
    else if (r === 'needs-passphrase') setMode('join');
    else setMode('idle');
  };

  return (
    <div className="card">
      <span className="label">iPhone と iPad の同期</span>
      {!meta.syncEnabled ? (
        <>
          <span className="sub">
            どちらの端末からでも記録できるようになります。データは端末の中で暗号化してから送るので、サーバーからは中身を読めません。もう一方の端末では、同じ合言葉を1回入れます。
          </span>
          {mode === 'idle' && (
            <button className="btn" disabled={busy} onClick={start}>
              {busy ? '準備中…' : '同期を始める'}
            </button>
          )}
          {mode === 'set-passphrase' && (
            <>
              <span className="sub">まず合言葉を決めてください（自動バックアップと同じ合言葉です）。</span>
              <PassphraseForm submitLabel="合言葉を決めて同期を始める" onDone={start} />
            </>
          )}
          {mode === 'join' && (
            <>
              <span className="sub">もう一方の端末ですでに同期を始めています。その端末で決めた合言葉を入れてください。</span>
              <JoinSyncForm onDone={() => setMode('idle')} />
            </>
          )}
        </>
      ) : status.state === 'needs-passphrase' ? (
        <>
          <span className="sub">もう一方の端末で合言葉が変わりました。新しい合言葉を入れると同期を再開します。</span>
          <JoinSyncForm submitLabel="同期を再開する" />
        </>
      ) : (
        <>
          <span className="sub">
            {status.state === 'syncing'
              ? '同期しています…'
              : status.state === 'error'
                ? '同期できませんでした。電波のよいところで開き直すと再開します。'
                : `最後の同期：${when(status.lastSyncAt ?? meta.lastSyncAt, today)}`}
          </span>
          <div className="row">
            <button className="btn" style={{ flex: 1 }} disabled={status.state === 'syncing'} onClick={() => runSync()}>
              今すぐ同期
            </button>
            <button
              className="btn-ghost"
              onClick={() => window.confirm('この端末の同期をやめますか？この端末のデータは消えません。') && disableSync()}
            >
              やめる
            </button>
          </div>
        </>
      )}
    </div>
  );
}
