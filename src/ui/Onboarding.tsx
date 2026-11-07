import { useState } from 'react';
import { completeOnboarding } from '../lib/actions';
import { supabase } from '../lib/supabase';
import { RestoreCard } from './Backup';
import { JoinSyncForm } from './SyncSettings';
import { emptyTrackForm, isTrackFormValid, TrackForm, trackFormToInput } from './TrackForm';

// 初回案内：取り組みを1つ作る（§3.1）。以前のデータがあれば、同期・バックアップから戻す。
//
// iPad（iPadOS 27.2）のホーム画面アプリでは、文字欄とパスワード欄が同じ画面にあると
// 入力欄をタップした瞬間に落ちるため、合言葉の入力は別の画面に分ける
export function Onboarding() {
  const [mode, setMode] = useState<'create' | 'join' | 'restore'>('create');
  const [value, setValue] = useState(emptyTrackForm);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { input, steps } = trackFormToInput(value);
    try {
      await completeOnboarding(input, steps);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'join') {
    return (
      <main className="screen">
        <div className="head">
          <span className="sub">はじめに</span>
          <h1 className="title">もう一方の端末と同期する</h1>
          <span className="sub">もう一方の端末（iPhone など）で同期を始めていれば、同じ合言葉を入れるとデータがそろいます。</span>
        </div>
        <div className="card">
          <JoinSyncForm submitLabel="同期してはじめる" />
        </div>
        <button className="btn-ghost" onClick={() => setMode('create')}>
          戻る
        </button>
      </main>
    );
  }

  if (mode === 'restore') {
    return (
      <main className="screen">
        <div className="head">
          <span className="sub">はじめに</span>
          <h1 className="title">以前のデータから戻す</h1>
        </div>
        <RestoreCard />
        <button className="btn-ghost" onClick={() => setMode('create')}>
          戻る
        </button>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="head">
        <span className="sub">はじめに</span>
        <h1 className="title">取り組みを1つ作りましょう</h1>
        <span className="sub">夜に明日のルートを組むとき、ここで作った取り組みが候補に並びます。あとから増やせます。</span>
      </div>
      <div className="card">
        <TrackForm value={value} onChange={setValue} />
      </div>
      <button className="btn-primary" disabled={!isTrackFormValid(value) || busy} onClick={submit}>
        この取り組みで始める
      </button>
      <div className="card">
        <span className="label">以前のデータがある場合</span>
        {supabase && (
          <button className="btn" onClick={() => setMode('join')}>
            もう一方の端末と同期する
          </button>
        )}
        <button className="btn" onClick={() => setMode('restore')}>
          バックアップやファイルから戻す
        </button>
      </div>
    </main>
  );
}
