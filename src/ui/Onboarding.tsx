import { useState } from 'react';
import { completeOnboarding } from '../lib/actions';
import { RestoreCard } from './Backup';
import { emptyTrackForm, isTrackFormValid, TrackForm, trackFormToInput } from './TrackForm';

// 初回案内：取り組みを1つ作る（§3.1）
export function Onboarding() {
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
      <RestoreCard />
    </main>
  );
}
