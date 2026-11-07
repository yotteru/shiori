import { useEffect, useRef, useState } from 'react';
import { itemFromCandidate, lastWindow, savePlan, type SavePlanResult } from '../lib/actions';
import { buildCandidates, candidateKey, type Candidate } from '../lib/candidates';
import { nowIso } from '../lib/clock';
import { db } from '../lib/db';
import { formatLifeDateJa } from '../lib/lifeDate';
import { assignTimes, capacity } from '../lib/schedule';
import type { Leftover, Plan, PlanItem, Step, Track } from '../lib/types';
import { TimeSelect } from './common';

// 明日を組む（案2-A、§3.4-3）

export function kindLabel(kind: Candidate['kind']): string {
  return kind === 'leftover' ? 'やり残し' : kind === 'project' ? 'プロジェクト' : '習慣';
}

interface Stop {
  key: string;
  leftoverId?: string;
  item: PlanItem;
}

interface BuilderState {
  window: Plan['window'];
  stops: Stop[];
}

export function PlanBuilder({ today, planFor, tracks, steps, leftovers, onSaved }: {
  today: string;
  planFor: string;
  tracks: Track[];
  steps: Step[];
  leftovers: Leftover[];
  onSaved: (plan: Plan, result: SavePlanResult) => void;
}) {
  const draftKey = `plan-builder:${planFor}`;
  const [state, setState] = useState<BuilderState | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  // 初期値：書きかけ → 保存済みの計画 → 前回の時間帯
  useEffect(() => {
    let alive = true;
    (async () => {
      const draft = await db.drafts.get(draftKey);
      let init: BuilderState | null = null;
      if (draft) {
        try {
          init = JSON.parse(draft.value) as BuilderState;
        } catch {
          init = null;
        }
      }
      if (!init) {
        const existing = await db.plans.get(planFor);
        init = existing
          ? { window: existing.window, stops: existing.items.map((item) => ({ key: candidateKey(item.trackId, item.stepId), item })) }
          : { window: await lastWindow(), stops: [] };
      }
      if (alive) setState(init);
    })();
    return () => {
      alive = false;
    };
  }, [draftKey, planFor]);

  const update = (next: BuilderState) => {
    setState(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void db.drafts.put({ key: draftKey, value: JSON.stringify(next), updatedAt: nowIso() });
    }, 500);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  if (!state) return null;

  const candidates = buildCandidates({ today, tracks, steps, leftovers });
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? '';
  const minutes = state.stops.map((s) => s.item.minutes);
  const times = assignTimes(state.window.start, minutes);
  const cap = capacity(state.window, minutes);
  const inPlan = new Set(state.stops.map((s) => s.key));

  const add = (c: Candidate) => {
    if (inPlan.has(c.key)) return;
    update({ ...state, stops: [...state.stops, { key: c.key, leftoverId: c.leftoverId, item: itemFromCandidate(c) }] });
  };
  const moveUp = (i: number) => {
    if (i === 0) return;
    const stops = state.stops.slice();
    [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]];
    update({ ...state, stops });
  };
  const remove = (i: number) => update({ ...state, stops: state.stops.filter((_, j) => j !== i) });
  const editFirst = (i: number, firstStep: string) =>
    update({ ...state, stops: state.stops.map((s, j) => (j === i ? { ...s, item: { ...s.item, firstStep } } : s)) });

  const save = async () => {
    setBusy(true);
    if (timer.current) window.clearTimeout(timer.current);
    const plan: Plan = {
      lifeDate: planFor,
      window: state.window,
      createdAt: nowIso(),
      source: 'night',
      items: state.stops.map((s) => ({ ...s.item, firstStep: s.item.firstStep.trim() })),
    };
    const used = state.stops.map((s) => s.leftoverId).filter((x): x is string => !!x);
    const result = await savePlan(plan, used);
    await db.drafts.delete(draftKey);
    onSaved(plan, result);
  };

  const pct = Math.min(100, Math.round((cap.used / Math.max(cap.total, 1)) * 100));

  return (
    <>
      <div className="head">
        <h1 className="title">明日のルートを組む</h1>
        <span className="sub">{formatLifeDateJa(planFor)}</span>
      </div>

      <div className="card">
        <span className="label">使える時間帯</span>
        <div className="row">
          <TimeSelect label="開始" value={state.window.start} onChange={(start) => update({ ...state, window: { ...state.window, start } })} />
          <span className="muted" style={{ flex: 'none' }}>〜</span>
          <TimeSelect label="終了" value={state.window.end} onChange={(end) => update({ ...state, window: { ...state.window, end } })} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="label">使う時間</span>
          <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
            {cap.used}分 / {cap.total}分
          </span>
        </div>
        <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={cap.total} aria-valuenow={cap.used} aria-label="使う時間">
          <div style={{ width: `${pct}%`, background: cap.over ? 'var(--warn)' : 'var(--done)' }} />
        </div>
        <span className="small" style={{ color: cap.over ? 'var(--warn)' : 'var(--done)' }}>
          {cap.over ? '時間が足りません。どれかを次の日に回しましょう' : `あと ${cap.remaining}分 入れられます`}
        </span>
      </div>

      <div className="card" style={{ gap: 4 }}>
        <span className="label" style={{ marginBottom: 6 }}>明日のしおり</span>
        {state.stops.length === 0 && <span className="sub" style={{ padding: '16px 0' }}>下の空白から行き先を選んでください</span>}
        {state.stops.map((s, i) => (
          <div key={s.item.id} className="stop">
            <div className="stop-time">
              <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{times[i]}</span>
              <span className="line" />
            </div>
            <div className="stop-body">
              <span className="small muted" style={{ fontSize: 11 }}>
                {trackName(s.item.trackId)}・{s.item.minutes}分
              </span>
              <span className="t">{s.item.title}</span>
              <label className="stack" style={{ gap: 0 }}>
                <span className="first-step">最初の一手</span>
                <input
                  className="inline-input"
                  aria-label={`${s.item.title}の最初の一手`}
                  value={s.item.firstStep}
                  placeholder="（未記入）"
                  onChange={(e) => editFirst(i, e.target.value)}
                />
              </label>
            </div>
            <div className="stop-actions">
              <button className="btn-icon" aria-label="ひとつ前へ" disabled={i === 0} onClick={() => moveUp(i)}>
                ↑
              </button>
              <button className="btn-icon muted" aria-label="しおりから外す" onClick={() => remove(i)}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="stack">
        <span className="section-label">まだ埋まっていない空白（タップで追加）</span>
        {candidates.length === 0 && <span className="sub">候補がありません。「取り組み」から追加できます。</span>}
        {candidates.map((c) => {
          const on = inPlan.has(c.key);
          return (
            <button key={c.key} className={`cand${on ? ' on' : ''}`} onClick={() => add(c)} aria-disabled={on}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="k">
                  {kindLabel(c.kind)}・{c.trackName}
                </span>
                <span className="t">{c.title}</span>
                {c.lastNote && <span className="note">前回：{c.lastNote.text}</span>}
              </span>
              <span className="badge">{on ? '追加済み' : `＋ ${c.minutes}分`}</span>
            </button>
          );
        })}
      </div>

      <button className="btn-primary" disabled={state.stops.length === 0 || busy} onClick={save}>
        この計画で明日を迎える
      </button>
      <span className="small muted center">明日の朝は、最初の行き先だけが開いた状態で始まります</span>
    </>
  );
}
