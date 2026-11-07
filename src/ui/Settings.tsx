import { useState, type ReactNode } from 'react';
import { useNow } from '../hooks';
import { isDebugNowActive } from '../lib/clock';
import { saveDebugNow } from '../lib/db';
import { jstTime, lifeDate } from '../lib/lifeDate';
import { supabase } from '../lib/supabase';
import { TimeSelect } from './common';

// 設定（§3.6）。バックアップ・書き出し・通知テストは後の段階で sections に差し込む
export function Settings({ sections }: { sections?: ReactNode }) {
  return (
    <>
      <h1 className="title">設定</h1>
      {sections}
      {supabase && (
        <div className="card">
          <span className="label">アカウント</span>
          <span className="sub">ログアウトしても、この端末のデータは消えません。</span>
          <button className="btn" onClick={() => supabase?.auth.signOut()}>
            ログアウト
          </button>
        </div>
      )}
      <DebugNowCard />
    </>
  );
}

function jstDate(d: Date): string {
  // 'YYYY-MM-DD'（JST の暦日。生活日ではない）
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 開発用：今の日時を指定する（§6） */
function DebugNowCard() {
  const now = useNow();
  const [date, setDate] = useState(() => jstDate(now));
  const [time, setTime] = useState(() => {
    const t = jstTime(now);
    return `${t.slice(0, 3)}${String(Math.floor(Number(t.slice(3)) / 5) * 5).padStart(2, '0')}`;
  });
  const active = isDebugNowActive();

  return (
    <div className="card">
      <span className="label">開発用：今の日時を指定する</span>
      <span className="sub">
        いまアプリが使っている日時：{jstDate(now)} {jstTime(now)}（生活日 {lifeDate(now)}）{active ? '・上書き中' : ''}
      </span>
      <div className="row">
        <input className="input mono" type="date" aria-label="日付" value={date} onChange={(e) => setDate(e.target.value)} />
        <TimeSelect label="時刻" value={time} step={5} onChange={setTime} />
      </div>
      <button className="btn" disabled={!date} onClick={() => saveDebugNow(new Date(`${date}T${time}:00+09:00`).toISOString())}>
        この日時にする
      </button>
      {active && (
        <button className="btn-ghost" onClick={() => saveDebugNow(null)}>
          上書きを解除する
        </button>
      )}
    </div>
  );
}
