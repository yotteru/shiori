import { useState } from 'react';
import { supabase } from '../lib/supabase';

// 23時の LINE 通知の説明とテスト送信（§5.3）。2026-11-09 に「通知」へまとめた
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
    <div className="stack">
      <span className="label">23時の LINE</span>
      <span className="sub">毎晩23:00に、明日のルートをまだ組んでいなければ LINE に届きます（時刻の変更は SQL で行います）。</span>
      <button className="btn" disabled={busy} onClick={send}>
        テスト送信
      </button>
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}
