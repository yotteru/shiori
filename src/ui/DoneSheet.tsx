import { useState } from 'react';
import { markDone } from '../lib/actions';
import { formatMinute } from '../lib/calendar';
import type { PlanItem } from '../lib/types';
import { Sheet } from './common';
import { useDraft } from './useDraft';

export const FEEL_LABEL = { 1: 'いつもどおり', 2: 'よかった', 3: 'すごくよかった' } as const;

/** 済をつける：「次はここから」を1行残せる（空欄でもよい） */
export function DoneSheet({ item, lifeDate, habit, onClose, onDone }: { item: PlanItem; lifeDate: string; habit?: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote, clearDraft] = useDraft(`next-note:${lifeDate}:${item.id}`);
  const [busy, setBusy] = useState(false);
  const [feel, setFeel] = useState<1 | 2 | 3 | undefined>(undefined);
  // 済は「今回の分」。ステップを終えるのは、自分で決めたときだけ（2026-11-10）
  const [completeStep, setCompleteStep] = useState(false);
  const submit = async () => {
    setBusy(true);
    await markDone(lifeDate, item.id, note, undefined, feel, completeStep);
    await clearDraft();
    onDone();
  };
  return (
    <Sheet onClose={onClose} label="済をつける">
      <div className="head">
        <span className="sub">
          済をつける
          {item.start !== undefined && <span className="mono">・{formatMinute(item.start)}–{formatMinute(item.start + item.minutes)}</span>}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{item.title}</span>
      </div>
      <label className="field">
        <span>次はここから（空欄でも大丈夫）</span>
        <span className="small muted">次にこの取り組みを置いたとき、最初の一手として出ます。</span>
        <input
          className="input"
          value={note}
          placeholder="例：配管が壁を跨ぐときの判定から"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
        />
      </label>
      {item.stepId && (
        <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <input type="checkbox" style={{ marginTop: 4 }} checked={completeStep} onChange={(e) => setCompleteStep(e.target.checked)} />
          <span className="stack" style={{ gap: 2 }}>
            <span>このステップは完了</span>
            <span className="small muted">オフのままなら、次も同じステップが候補に出ます</span>
          </span>
        </label>
      )}
      {habit && (
        <div className="field">
          <span>手応え（選ばなくても大丈夫）</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {([1, 2, 3] as const).map((f) => (
              <button key={f} className={`chip-btn${feel === f ? ' accent' : ''}`} aria-pressed={feel === f} onClick={() => setFeel(feel === f ? undefined : f)}>
                {FEEL_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="btn-primary" onClick={submit} disabled={busy}>
        済をつける
      </button>
      <button className="btn-ghost" onClick={onClose}>
        やめる
      </button>
    </Sheet>
  );
}
