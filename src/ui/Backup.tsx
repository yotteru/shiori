import { useRef, useState } from 'react';
import { useLive, useNow } from '../hooks';
import { fetchLatestBackup, hasBackupKey, restoreFromRow, runBackup, setPassphrase } from '../lib/backup';
import { toDate } from '../lib/clock';
import { DecryptError } from '../lib/crypto';
import { getMeta, isLocalDataEmpty } from '../lib/db';
import { exportNow, readBackupFile, shouldRemindExport } from '../lib/exportFile';
import { diffDays, jstTime, lifeDate } from '../lib/lifeDate';
import { InvalidBackupError, replaceAll, type BackupFile } from '../lib/snapshot';
import { supabase } from '../lib/supabase';
import { afterPassphraseChanged } from '../lib/syncRuntime';
import { Sheet } from './common';
import { JoinSyncForm } from './SyncSettings';

// バックアップまわりの画面部品（指示書 §4）

function since(iso: string | undefined, today: string): string {
  if (!iso) return 'まだありません';
  const d = diffDays(lifeDate(toDate(iso)), today);
  const t = jstTime(toDate(iso));
  return d <= 0 ? `今日 ${t}` : `${d}日前`;
}

/** 合言葉の設定。iPhone のパスワード管理に保存できるよう autocomplete="new-password" */
export function PassphraseForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = p1.length > 0 && p1.length < 8;
  const mismatch = p2.length > 0 && p1 !== p2;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await setPassphrase(p1);
    // 同期中なら、新しい合言葉で全件を送り直す（もう一方の端末は新しい合言葉の入力待ちになる）
    await afterPassphraseChanged().catch(() => {});
    setP1('');
    setP2('');
    setBusy(false);
    onDone();
  };
  return (
    <form className="stack" onSubmit={submit}>
      {/* パスワード管理がどのアカウントの合言葉か分かるように */}
      <input type="text" name="username" autoComplete="username" value="しおり バックアップ" readOnly hidden />
      <label className="field">
        <span>合言葉（8文字以上）</span>
        <input className="input" type="password" name="new-password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
      </label>
      <label className="field">
        <span>もう一度</span>
        <input className="input" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
      </label>
      {tooShort && <span className="error">8文字以上にしてください</span>}
      {mismatch && <span className="error">2つの合言葉が一致しません</span>}
      <span className="small muted">合言葉を忘れるとバックアップは開けません。パスワード管理に保存しておいてください。</span>
      <button className="btn-primary" type="submit" disabled={busy || p1.length < 8 || p1 !== p2}>
        {busy ? '準備中…' : submitLabel}
      </button>
    </form>
  );
}

/** 夜の流れの完了画面に出す：合言葉の案内と、7日書き出していないときの書き出しボタン */
export function NightFinishedExtras() {
  const now = useNow();
  const meta = useLive(() => getMeta(), []);
  const hasKey = useLive(() => hasBackupKey(), []);
  const [skipped, setSkipped] = useState(false);
  const [setting, setSetting] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  if (!meta || hasKey === undefined) return null;

  return (
    <>
      {supabase && !hasKey && !skipped && (
        <div className="card">
          <span className="label">合言葉を設定するとバックアップが始まります</span>
          <span className="sub">計画を保存するたびに、端末の中で暗号化してからサーバーに送ります。サーバーからは中身を読めません。</span>
          {setting ? (
            <PassphraseForm
              submitLabel="設定してバックアップする"
              onDone={async () => {
                const r = await runBackup();
                setBackupMsg(r === 'ok' ? 'バックアップしました' : 'バックアップに失敗しました。次回の保存時にもう一度行います。');
              }}
            />
          ) : (
            <div className="row">
              <button className="btn" style={{ flex: 1 }} onClick={() => setSetting(true)}>
                合言葉を設定する
              </button>
              <button className="btn-ghost" onClick={() => setSkipped(true)}>
                あとで
              </button>
            </div>
          )}
        </div>
      )}
      {backupMsg && <p className="small muted" style={{ margin: 0 }}>{backupMsg}</p>}
      {shouldRemindExport(meta.lastExportAt, now) && <ExportReminder lastExportAt={meta.lastExportAt} today={lifeDate(now)} />}
    </>
  );
}

function ExportReminder({ lastExportAt, today }: { lastExportAt?: string; today: string }) {
  const [msg, setMsg] = useState('');
  return (
    <div className="card">
      <span className="label">Googleドライブへの書き出し</span>
      <span className="sub">最後の書き出し：{since(lastExportAt, today)}。共有メニューで「ファイルに保存」→ Google ドライブを選んでください。</span>
      <button
        className="btn"
        onClick={async () => {
          const r = await exportNow();
          setMsg(r === 'cancelled' ? '' : '書き出しました');
        }}
      >
        Googleドライブに書き出す
      </button>
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}

/** 設定画面：自動バックアップ */
export function BackupSettings() {
  const now = useNow();
  const meta = useLive(() => getMeta(), []);
  const hasKey = useLive(() => hasBackupKey(), []);
  const [changing, setChanging] = useState(false);
  const [msg, setMsg] = useState('');
  if (!supabase || !meta || hasKey === undefined) return null;
  return (
    <div className="card">
      <span className="label">自動バックアップ</span>
      <span className="sub">
        {hasKey ? `最後のバックアップ：${since(meta.lastBackupAt, lifeDate(now))}` : '合言葉が未設定のため、バックアップは止まっています'}
      </span>
      {changing || !hasKey ? (
        <PassphraseForm
          submitLabel={hasKey ? '合言葉を変更する' : '合言葉を設定する'}
          onDone={async () => {
            setChanging(false);
            const r = await runBackup();
            setMsg(r === 'ok' ? 'バックアップしました' : 'バックアップに失敗しました');
          }}
        />
      ) : (
        <div className="row">
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={async () => {
              setMsg('送信中…');
              const r = await runBackup();
              setMsg(r === 'ok' ? 'バックアップしました' : 'バックアップに失敗しました');
            }}
          >
            今すぐバックアップ
          </button>
          <button className="btn-ghost" onClick={() => setChanging(true)}>
            合言葉を変更
          </button>
        </div>
      )}
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}

/** 設定画面：Google ドライブへの書き出し・読み込み */
export function ExportSettings() {
  const now = useNow();
  const meta = useLive(() => getMeta(), []);
  const [msg, setMsg] = useState('');
  if (!meta) return null;
  return (
    <div className="card">
      <span className="label">Googleドライブへの書き出し</span>
      <span className="sub">最後の書き出し：{since(meta.lastExportAt, lifeDate(now))}</span>
      <button
        className="btn"
        onClick={async () => {
          const r = await exportNow();
          setMsg(r === 'cancelled' ? '' : '書き出しました');
        }}
      >
        書き出す
      </button>
      <ImportButton onDone={() => setMsg('読み込みました')} />
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}

/** ファイルから読み込む：検証 → 今のデータを書き出す → 確認 → 置き換え */
export function ImportButton({ onDone, label = 'ファイルから読み込む' }: { onDone: () => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<BackupFile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const localEmpty = useLive(() => isLocalDataEmpty(), []);

  const pick = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    try {
      setFile(await readBackupFile(f));
    } catch (e) {
      setError(e instanceof InvalidBackupError ? e.message : '読み込めませんでした。');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      if (!localEmpty) {
        const r = await exportNow();
        if (r === 'cancelled') {
          setError('今のデータの書き出しがキャンセルされたので、読み込みを中止しました。');
          return;
        }
      }
      if (!window.confirm('今のデータを、このファイルの内容で置き換えます。よろしいですか？')) return;
      await replaceAll(file);
      setFile(null);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button className="btn" onClick={() => input.current?.click()}>
        {label}
      </button>
      {error && <span className="error">{error}</span>}
      {file && (
        <Sheet onClose={() => setFile(null)} label="ファイルから読み込む">
          <span style={{ fontSize: 18, fontWeight: 700 }}>このファイルで置き換えますか？</span>
          <span className="sub">
            書き出した日時：{file.exportedAt.slice(0, 16).replace('T', ' ')}（UTC）／取り組み {file.tracks.length}・計画 {file.plans.length}・ジャーナル {file.journals.length}
          </span>
          {!localEmpty && <span className="sub">置き換える前に、今のデータを書き出します（共有メニューが開きます）。</span>}
          <button className="btn-primary" disabled={busy} onClick={apply}>
            {localEmpty ? '読み込む' : '今のデータを書き出してから置き換える'}
          </button>
          <button className="btn-ghost" onClick={() => setFile(null)}>
            やめる
          </button>
        </Sheet>
      )}
    </>
  );
}

/** 初回案内（端末内が空のとき）：バックアップから戻す */
export function RestoreCard() {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const restore = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const row = await fetchLatestBackup();
      if (!row) {
        setMsg('サーバーにバックアップがありません。');
        return;
      }
      await restoreFromRow(row, pass);
      setPass('');
    } catch (err) {
      setMsg(err instanceof DecryptError ? '合言葉が違うようです。' : err instanceof InvalidBackupError ? err.message : 'バックアップを取得できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <span className="label">以前のデータがある場合</span>
      {supabase && (
        <>
          <span className="sub">もう一方の端末で同期を始めているなら、同じ合言葉を入れるとデータがそろいます。</span>
          <JoinSyncForm submitLabel="もう一方の端末と同期する" />
          <span className="sub" style={{ marginTop: 8 }}>同期を使っていない場合は、バックアップやファイルから戻せます。</span>
        </>
      )}
      {supabase &&
        (open ? (
          <form className="stack" onSubmit={restore}>
            <label className="field">
              <span>合言葉</span>
              <input
                className="input"
                type="password"
                name="shiori-restore-pass"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </label>
            <button className="btn-primary" type="submit" disabled={busy || !pass}>
              {busy ? '復元中…' : '最新のバックアップから戻す'}
            </button>
          </form>
        ) : (
          <button className="btn" onClick={() => setOpen(true)}>
            バックアップから戻す
          </button>
        ))}
      <ImportButton onDone={() => setMsg('読み込みました')} />
      {msg && <span className={msg.endsWith('ました') ? 'small muted' : 'error'}>{msg}</span>}
    </div>
  );
}

