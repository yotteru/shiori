import { useState } from 'react';
import { markDone } from '../lib/actions';
import type { PlanItem } from '../lib/types';
import { Sheet } from './common';
import { useDraft } from './useDraft';

/** 済をつける：「次はここから」を1行残せる（空欄でもよい） */
export function DoneSheet({ item, lifeDate, onClose, onDone }: { item: PlanItem; lifeDate: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote, clearDraft] = useDraft(`next-note:${lifeDate}:${item.id}`);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await markDone(lifeDate, item.id, note);
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
        <input
          className="input"
          value={note}
          placeholder="例：配管が壁を跨ぐときの判定から"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
        />
      </label>
      <button className="btn-primary" onClick={submit} disabled={busy}>
        済をつける
      </button>
      <button className="btn-ghost" onClick={onClose}>
        やめる
      </button>
    </Sheet>
  );
}
