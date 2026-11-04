import type { NewStep } from '../lib/actions';
import type { Track } from '../lib/types';
import { MinutesSelect } from './common';

export interface TrackFormValue {
  name: string;
  type: Track['type'];
  defaultMinutes: number;
  defaultFirstStep: string;
  steps: NewStep[];
}

const emptyStep = (): NewStep => ({ title: '', minutes: 45, firstStep: '' });

export function isTrackFormValid(v: TrackFormValue): boolean {
  if (!v.name.trim()) return false;
  if (v.type === 'project') return v.steps.some((s) => s.title.trim());
  return true;
}

/** 取り組みの作成フォーム（初回案内と取り組み画面で使う） */
export function TrackForm({ value, onChange }: { value: TrackFormValue; onChange: (v: TrackFormValue) => void }) {
  const set = (patch: Partial<TrackFormValue>) => onChange({ ...value, ...patch });
  const setStep = (i: number, patch: Partial<NewStep>) =>
    set({ steps: value.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="field">
        <span>名前</span>
        <input className="input" value={value.name} placeholder="例：筋トレ、アドインの干渉判定" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="field">
        <span>種類</span>
        <div className="seg" role="group" aria-label="種類">
          <button type="button" aria-pressed={value.type === 'habit'} onClick={() => set({ type: 'habit' })}>
            習慣型
          </button>
          <button type="button" aria-pressed={value.type === 'project'} onClick={() => set({ type: 'project' })}>
            プロジェクト型
          </button>
        </div>
        <span className="sub">
          {value.type === 'habit' ? '毎回同じ行き先を繰り返す（例：ジムに行く）' : 'ステップに分けられて、終わりがある'}
        </span>
      </div>
      {value.type === 'habit' ? (
        <>
          <label className="field">
            <span>いつもの所要時間</span>
            <MinutesSelect value={value.defaultMinutes} onChange={(m) => set({ defaultMinutes: m })} />
          </label>
          <label className="field">
            <span>いつもの最初の一手</span>
            <input className="input" value={value.defaultFirstStep} placeholder="例：バッグを持って家を出る" onChange={(e) => set({ defaultFirstStep: e.target.value })} />
          </label>
        </>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {value.steps.map((s, i) => (
            <div key={i} className="card" style={{ padding: 12, border: '1px solid var(--line-soft)' }}>
              <span className="label">ステップ {i + 1}</span>
              <input className="input" aria-label={`ステップ${i + 1}の内容`} value={s.title} placeholder="例：壁を跨ぐケースを検証" onChange={(e) => setStep(i, { title: e.target.value })} />
              <div className="row">
                <span className="sub" style={{ flex: 'none' }}>所要時間</span>
                <MinutesSelect value={s.minutes} onChange={(m) => setStep(i, { minutes: m })} />
              </div>
              <input className="input" aria-label={`ステップ${i + 1}の最初の一手`} value={s.firstStep} placeholder="最初の一手（例：試行モデルを作る）" onChange={(e) => setStep(i, { firstStep: e.target.value })} />
              {value.steps.length > 1 && (
                <button type="button" className="btn-ghost" onClick={() => set({ steps: value.steps.filter((_, j) => j !== i) })}>
                  このステップを外す
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn" onClick={() => set({ steps: [...value.steps, emptyStep()] })}>
            ステップを追加
          </button>
        </div>
      )}
    </div>
  );
}

export function emptyTrackForm(): TrackFormValue {
  return { name: '', type: 'habit', defaultMinutes: 60, defaultFirstStep: '', steps: [emptyStep()] };
}

export function trackFormToInput(v: TrackFormValue) {
  const base = { name: v.name.trim(), type: v.type };
  if (v.type === 'habit') {
    return { input: { ...base, defaultMinutes: v.defaultMinutes, defaultFirstStep: v.defaultFirstStep.trim() || undefined }, steps: [] };
  }
  return {
    input: base,
    steps: v.steps.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim(), firstStep: s.firstStep.trim() })),
  };
}
