import { useState } from 'react';
import { markDone } from '../lib/actions';
import type { PlanItem } from '../lib/types';
import { Sheet } from './common';
import { useDraft } from './useDraft';

export const FEEL_LABEL = { 1: 'いつもどおり', 2: 'よかった', 3: 'すごくよかった' } as const;

/** 済をつける：「次はここから」を1行残せる（空欄でもよい） */
export function DoneSheet({ item, lifeDate, habit, onClose, onDone }: { item: PlanItem; lifeDate: string; habit?: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote, clearDraft] = useDraft(`next-note:${lifeDate}:${item.id}`);
  const [busy, setBusy] = useState(false);
  const [feel, setFeel] = useState<1 | 2 | 3 | undefined>(undefined);
  const submit = async () => {
    setBusy(true);
    await markDone(lifeDate, item.id, note, undefined, feel);
    await clearDraft();
    onDone();
  };
  return (
    <Sheet onClose={onClose} label="済をつける">
      <div className="head">
        <span className="sub">済をつける</span>
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
