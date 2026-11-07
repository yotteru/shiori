import { useState } from 'react';
import { supabase } from '../lib/supabase';

// 通知のテスト送信（§5.3）
export function NotifySettings() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!supabase) return null;
  const send = async () => {
    setBusy(true);
    setMsg('');
    const { error } = await supabase!.rpc('send_test_notification');
    setBusy(false);
    setMsg(error ? '送信できませんでした。README の通知の設定を確かめてください。' : '送信しました。LINE を確認してください。');
  };
  return (
    <div className="card">
      <span className="label">通知</span>
      <span className="sub">毎晩23:00に、明日のルートをまだ組んでいなければ LINE に届きます（時刻の変更は SQL で行います）。</span>
      <button className="btn" disabled={busy} onClick={send}>
        テスト送信
      </button>
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}
