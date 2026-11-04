import { quickStart } from '../lib/actions';
import { buildCandidates, lastDoneByTrack, morningCandidates } from '../lib/candidates';
import { formatLifeDateJa } from '../lib/lifeDate';
import type { Leftover, Plan, Step, Track } from '../lib/types';
import { kindLabel } from './PlanBuilder';

// 計画がない朝の簡易版（§3.2）：候補3件から1タップで今日の最初の行き先にする
export function MorningQuick({ today, tracks, steps, leftovers, plans }: {
  today: string;
  tracks: Track[];
  steps: Step[];
  leftovers: Leftover[];
  plans: Plan[];
}) {
  const all = buildCandidates({ today, tracks, steps, leftovers });
  const top = morningCandidates(all, tracks, lastDoneByTrack(plans, steps));

  return (
    <>
      <div className="head">
        <span className="sub">{formatLifeDateJa(today)}</span>
        <h1 className="title">今日の最初の行き先</h1>
        <span className="sub">1つ選ぶと、それが今日のしおりになります</span>
      </div>
      {top.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }} className="sub">候補がありません。「取り組み」から追加してください。</p>
        </div>
      ) : (
        <div className="stack">
          {top.map((c) => (
            <button key={c.key} className="cand" onClick={() => quickStart(today, c)}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="k">
                  {kindLabel(c.kind)}・{c.trackName}
                </span>
                <span className="t">{c.title}</span>
                {c.lastNote && <span className="note">前回：{c.lastNote.text}</span>}
                {c.firstStep && <span className="first-step">最初の一手：{c.firstStep}</span>}
              </span>
              <span className="badge">{c.minutes}分</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
