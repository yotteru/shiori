import { useState } from 'react';
import { finalizeReview, saveJournal } from '../lib/actions';
import { JOURNAL_MAX_LENGTH, type Plan } from '../lib/types';
import { useDraft } from './useDraft';

// 答え合わせと1行ジャーナル（§3.4 の1・2）。2026-11-08 から夜の一本道をやめ、いつでも単独でできる

/** 答え合わせ：まだ済でない行き先を済か未に決める。未はやり残しとして候補の先頭に回る */
export function ReviewCard({ plan, title, note, collapsed = false }: { plan: Plan; title: string; note?: string; collapsed?: boolean }) {
  const [decisions, setDecisions] = useState<Record<string, 'done' | 'undone'>>(() =>
    Object.fromEntries(plan.items.map((i) => [i.id, i.status === 'done' ? 'done' : 'undone'])),
  );
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(!collapsed);
  const planned = plan.items.filter((i) => i.status === 'planned').length;
  const done = plan.items.filter((i) => i.status === 'done').length;
  const undone = plan.items.filter((i) => i.status === 'undone').length;

  if (!plan.items.length) return null;
  if (planned === 0 && !open) {
    return (
      <div className="card-tight row" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <span className="small muted">
          答え合わせ済み（済 {done}・未 {undone}）
        </span>
        <button className="btn-ghost" onClick={() => setOpen(true)}>
          やり直す
        </button>
      </div>
    );
  }

  // 今日の答え合わせは、本人が始めたいときに開く（ふだんは畳んでおく）
  if (!expanded) {
    return (
      <button className="btn" onClick={() => setExpanded(true)}>
        {title}をする
      </button>
    );
  }

  const confirm = async () => {
    setBusy(true);
    await finalizeReview(plan.lifeDate, decisions);
    setBusy(false);
    setOpen(false);
  };

  return (
    <div className="card">
      <span className="label">{title}</span>
      <span className="sub">{note ?? '未にしたものは、やり残しとして候補の先頭に並びます。'}</span>
      {plan.items.map((item) => (
        <div key={item.id} className="review-row">
          <span style={{ fontSize: 15, fontWeight: 700, minWidth: 0 }}>{item.title}</span>
          <div className="seg" role="group" aria-label={`${item.title}の結果`}>
            <button aria-pressed={decisions[item.id] === 'done'} onClick={() => setDecisions({ ...decisions, [item.id]: 'done' })}>
              済
            </button>
            <button aria-pressed={decisions[item.id] === 'undone'} onClick={() => setDecisions({ ...decisions, [item.id]: 'undone' })}>
              未
            </button>
          </div>
        </div>
      ))}
      <button className="btn" disabled={busy} onClick={confirm}>
        答え合わせを確定する
      </button>
    </div>
  );
}

/** 1行ジャーナル。書きかけは自動保存し、「保存」で確定する */
export function JournalCard({ lifeDate, saved }: { lifeDate: string; saved: string }) {
  const [text, setText, clear, loaded] = useDraft(`journal:${lifeDate}`, saved);
  const [msg, setMsg] = useState('');
  const save = async () => {
    await saveJournal(lifeDate, text);
    await clear();
    setMsg('保存しました');
  };
  return (
    <div className="card">
      <span className="label">1行ジャーナル</span>
      <span className="sub">今日いちばん残ったことを1行。</span>
      <textarea
        className="textarea"
        aria-label="ジャーナル"
        value={text}
        maxLength={JOURNAL_MAX_LENGTH}
        disabled={!loaded}
        onChange={(e) => {
          setText(e.target.value);
          setMsg('');
        }}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{msg || (text !== saved ? '書きかけ（自動で下書き保存しています）' : '')}</span>
        <button className="btn" disabled={!loaded || text === saved} onClick={save}>
          保存
        </button>
      </div>
    </div>
  );
}
