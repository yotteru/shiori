import { useState, type ReactNode } from 'react';
import { useLive, useNow } from '../hooks';
import { finalizeReview, saveJournal, type SavePlanResult } from '../lib/actions';
import { db } from '../lib/db';
import { lifeDate, planForDate } from '../lib/lifeDate';
import { JOURNAL_MAX_LENGTH, type Plan } from '../lib/types';
import { PlanBuilder } from './PlanBuilder';
import { useDraft } from './useDraft';

// 夜の流れ（§3.4）：答え合わせ → 1行ジャーナル → 明日を組む → 完了

type StepName = 'review' | 'journal' | 'plan' | 'finished';

export function NightFlow({ onClose, finishedExtras }: {
  onClose: () => void;
  /** 完了画面に差し込む表示（バックアップの案内・書き出しボタンなど） */
  finishedExtras?: (result: SavePlanResult) => ReactNode;
}) {
  const now = useNow();
  // 夜の流れの途中で4時を過ぎても対象日がずれないよう、開いた時点の日付で固定する
  const [today] = useState(() => lifeDate(now));
  const [planFor] = useState(() => planForDate(now));
  const data = useLive(
    async () => ({
      plan: await db.plans.get(today),
      journal: await db.journals.get(today),
      tracks: await db.tracks.toArray(),
      steps: await db.steps.toArray(),
      leftovers: await db.leftovers.toArray(),
    }),
    [today],
  );
  const [step, setStep] = useState<StepName | null>(null);
  const [saved, setSaved] = useState<{ plan: Plan; result: SavePlanResult } | null>(null);

  if (!data) return null;
  const hasReview = !!data.plan && data.plan.items.length > 0;
  const current: StepName = step ?? (hasReview ? 'review' : 'journal');
  const order: StepName[] = hasReview ? ['review', 'journal', 'plan'] : ['journal', 'plan'];
  const index = order.indexOf(current);
  const back = index > 0 ? () => setStep(order[index - 1]) : null;

  return (
    <>
      {current !== 'finished' && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          {back ? (
            <button className="btn-ghost" onClick={back}>
              戻る
            </button>
          ) : (
            <span />
          )}
          <span className="steps-ind">
            {index + 1} / {order.length}
          </span>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>
      )}

      {current === 'review' && data.plan && (
        <Review plan={data.plan} onNext={() => setStep('journal')} />
      )}
      {current === 'journal' && (
        <JournalStep key={today} today={today} initial={data.journal?.text ?? ''} onNext={() => setStep('plan')} />
      )}
      {current === 'plan' && (
        <PlanBuilder
          today={today}
          planFor={planFor}
          tracks={data.tracks}
          steps={data.steps}
          leftovers={data.leftovers}
          onSaved={(plan, result) => {
            setSaved({ plan, result });
            setStep('finished');
          }}
        />
      )}
      {current === 'finished' && saved && (
        <Finished plan={saved.plan} result={saved.result} onClose={onClose} extras={finishedExtras?.(saved.result)} />
      )}
    </>
  );
}

function Review({ plan, onNext }: { plan: Plan; onNext: () => void }) {
  const [decisions, setDecisions] = useState<Record<string, 'done' | 'undone'>>(() =>
    Object.fromEntries(plan.items.map((i) => [i.id, i.status === 'done' ? 'done' : 'undone'])),
  );
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    await finalizeReview(plan.lifeDate, decisions);
    onNext();
  };
  return (
    <>
      <div className="head">
        <h1 className="title">今日の答え合わせ</h1>
        <span className="sub">未にしたものは、明日以降の候補の先頭に並びます</span>
      </div>
      <div className="card">
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
      </div>
      <button className="btn-primary" disabled={busy} onClick={next}>
        次へ
      </button>
    </>
  );
}

function JournalStep({ today, initial, onNext }: { today: string; initial: string; onNext: () => void }) {
  const [text, setText, clear, loaded] = useDraft(`journal:${today}`, initial);
  const [busy, setBusy] = useState(false);
  const next = async () => {
    setBusy(true);
    await saveJournal(today, text);
    await clear();
    onNext();
  };
  return (
    <>
      <div className="head">
        <h1 className="title">1行ジャーナル</h1>
        <span className="sub">今日いちばん残ったことを1行。空のままでも進めます</span>
      </div>
      <textarea
        className="textarea"
        aria-label="ジャーナル"
        value={text}
        maxLength={JOURNAL_MAX_LENGTH}
        disabled={!loaded}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn-primary" disabled={busy || !loaded} onClick={next}>
        次へ
      </button>
    </>
  );
}

function Finished({ plan, result, onClose, extras }: { plan: Plan; result: SavePlanResult; onClose: () => void; extras?: ReactNode }) {
  const first = plan.items[0];
  return (
    <>
      <div className="head">
        <span className="sub">保存しました</span>
        <h1 className="title">明日のルートができました</h1>
      </div>
      {first && (
        <section className="next-card">
          <span className="kicker">明日の最初の行き先</span>
          <span className="t">{first.title}</span>
          {first.firstStep && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="cap">最初の一手</span>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{first.firstStep}</span>
            </div>
          )}
        </section>
      )}
      {extras}
      {result.ping === 'failed' && (
        <p className="small muted" style={{ margin: 0 }}>
          計画した日付をサーバーに送れませんでした。次回の保存時にもう一度送ります。
        </p>
      )}
      {result.backup === 'failed' && (
        <p className="small muted" style={{ margin: 0 }}>
          自動バックアップに失敗しました。次回の保存時にもう一度行います。
        </p>
      )}
      <button className="btn-primary" onClick={onClose}>
        閉じる
      </button>
    </>
  );
}
