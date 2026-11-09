import { useEffect, useState } from 'react';
import { currentEndpoint, enablePush, pushPermission, schedulePush } from '../lib/push';
import { forgetSentStartReminders } from '../lib/startReminders';
import { supabase } from '../lib/supabase';

// この端末で通知を受け取る（Web プッシュ）の準備とテスト。2026-11-08 追加、2026-11-09 に「通知」へまとめた
export function PushSettings() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentEndpoint().then((e) => setReady(!!e));
  }, []);

  if (!supabase) return null;
  const perm = pushPermission();

  const enable = async () => {
    setBusy(true);
    setMsg('');
    const r = await enablePush();
    setBusy(false);
    setReady(r.ok);
    if (r.ok) forgetSentStartReminders();
    setMsg(r.ok ? 'この端末で通知を受け取れるようになりました。下のテストで確かめられます。' : r.reason);
  };

  const test = async (sec: number) => {
    setBusy(true);
    setMsg('');
    const id = await schedulePush('test', sec);
    setBusy(false);
    setMsg(
      id
        ? `${sec / 60}分後に届きます（1分ほど遅れることがあります）。iPhone の画面を消して待ってください。`
        : '予定を入れられませんでした。電波と、上の「通知を受け取る」を確かめてください。',
    );
  };

  return (
    <div className="stack">
      <span className="label">この端末で受け取る</span>
      <span className="sub">
        5分の知らせ・予定の開始時刻・日曜の知らせを、この端末に通知で送ります。iPhone の画面が消えていれば Apple Watch にも届きます。iPad やアプリを入れ直したときは、もう一度登録してください。
      </span>
      {perm === 'unsupported' ? (
        <span className="small muted">この画面では通知を使えません。ホーム画面のしおりから開いてください。</span>
      ) : (
        <>
          <span className="small muted">
            {ready === null ? '確認中…' : ready ? 'この端末：受け取る準備ができています' : 'この端末：まだ受け取る準備をしていません'}
          </span>
          <button className="btn" disabled={busy} onClick={enable}>
            {ready ? 'もう一度登録する' : 'この端末で通知を受け取る'}
          </button>
          <button className="btn" disabled={busy || !ready} onClick={() => test(60)}>
            テスト：1分後に届く
          </button>
        </>
      )}
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}
