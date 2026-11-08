import { useState } from 'react';
import { addMemo, deleteMemo, MEMO_MAX_LENGTH, shapeMemo, sortMemos } from '../lib/memos';
import { formatLifeDateJa, lifeDate } from '../lib/lifeDate';
import { toDate } from '../lib/clock';
import type { Memo } from '../lib/types';
import { Sheet } from './common';
import { emptyTrackForm, isTrackFormValid, TrackForm, trackFormToInput, type TrackFormValue } from './TrackForm';

// メモ箱（2026-11-08。画面案 3-C）：思いついたことを1行で。候補には出ない。整えたくなったものだけ取り組みにする

export function MemoInput({ onAdded, autoFocus }: { onAdded?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    await addMemo(text);
    setText('');
    onAdded?.();
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        className="input"
        aria-label="メモ"
        value={text}
        maxLength={MEMO_MAX_LENGTH}
        autoFocus={autoFocus}
        placeholder="思いついたことを1行で"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}
      />
      <button className="btn-primary" style={{ flex: 'none', minHeight: 48, padding: '0 16px', whiteSpace: 'nowrap' }} disabled={!text.trim()} onClick={() => void submit()}>
        入れる
      </button>
    </div>
  );
}

export function MemoBox({ memos, trackNames }: { memos: Memo[]; trackNames: Record<string, string> }) {
  const [shaping, setShaping] = useState<Memo | null>(null);
  const list = sortMemos(memos);
  return (
    <section className="card" aria-label="メモ箱">
      <span className="label">メモ箱</span>
      <span className="small muted">思いついたことを1行で放り込むだけ。種類も時間も決めなくていい。整えたくなったものだけ「整える」。</span>
      <MemoInput />
      {list.map((m) => (
        <div key={m.id} className="row" style={{ justifyContent: 'space-between', gap: 8, opacity: m.trackId ? 0.6 : 1, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
          <div className="stack" style={{ gap: 0, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 500, overflowWrap: 'anywhere' }}>{m.text}</span>
            <span className="small muted">
              {formatLifeDateJa(lifeDate(toDate(m.createdAt)))}
              {m.trackId ? `・取り組み「${trackNames[m.trackId] ?? '（消した取り組み）'}」に` : ''}
            </span>
          </div>
          <div className="row" style={{ flex: 'none', gap: 4 }}>
            {m.trackId ? (
              <span className="stamp">取り組みに</span>
            ) : (
              <button className="btn" style={{ minHeight: 40 }} onClick={() => setShaping(m)}>
                整える
              </button>
            )}
            <button
              className="btn-ghost"
              aria-label={`「${m.text}」を消す`}
              onClick={() => window.confirm(`「${m.text}」をメモ箱から消しますか？`) && void deleteMemo(m.id)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {list.length > 0 && <span className="small muted">メモのままでは、しおりの候補には出ません。</span>}
      {shaping && <ShapeSheet memo={shaping} onClose={() => setShaping(null)} />}
    </section>
  );
}

/** 整える：なりたい状態 → 習慣か終わりがあるか → ステップと最初の一手 */
function ShapeSheet({ memo, onClose }: { memo: Memo; onClose: () => void }) {
  const [goal, setGoal] = useState('');
  const [form, setForm] = useState<TrackFormValue>(() => ({ ...emptyTrackForm(), name: memo.text.slice(0, 60), type: 'project' }));
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    const { input, steps } = trackFormToInput(form);
    await shapeMemo(memo.id, { ...input, goal }, steps);
    onClose();
  };
  return (
    <Sheet onClose={onClose} label="メモから整える">
      <div className="head">
        <span className="sub">メモ箱から整える</span>
        <span style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{memo.text}</span>
      </div>
      <label className="field">
        <span>どうなったら「できた」？（なりたい状態・空欄でも大丈夫）</span>
        <input className="input" value={goal} placeholder="例：自分に合う英語のやり方が1つ決まっている" onChange={(e) => setGoal(e.target.value)} />
      </label>
      <TrackForm value={form} onChange={setForm} />
      <span className="small muted">最初の1つだけ決まっていれば大丈夫。残りはあとで足せます。</span>
      <button className="btn-primary" disabled={busy || !isTrackFormValid(form)} onClick={() => void make()}>
        取り組みにする
      </button>
      <button className="btn-ghost" onClick={onClose}>
        メモのまま置いておく
      </button>
    </Sheet>
  );
}
