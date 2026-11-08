import { useState } from 'react';
import { useLive, useNow } from '../hooks';
import {
  addStep,
  archiveTrack,
  changeTrackType,
  deleteTrack,
  createTrack,
  deleteLeftover,
  deleteStep,
  moveStepUp,
  restoreLeftover,
  updateStep,
  updateTrack,
} from '../lib/actions';
import { lastDoneByTrack } from '../lib/candidates';
import { db } from '../lib/db';
import { formatLifeDateJa, lifeDate } from '../lib/lifeDate';
import { daysSinceTouched, isStalled } from '../lib/tracks';
import type { Leftover, Step, Track } from '../lib/types';
import { MinutesSelect, Sheet } from './common';
import { emptyTrackForm, isTrackFormValid, TrackForm, trackFormToInput } from './TrackForm';

// 取り組み（§3.5）

export function Tracks() {
  const now = useNow();
  const today = lifeDate(now);
  const [tab, setTab] = useState<'tracks' | 'shelf'>('tracks');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const data = useLive(
    async () => ({
      tracks: await db.tracks.orderBy('createdAt').toArray(),
      steps: await db.steps.toArray(),
      plans: await db.plans.toArray(),
      leftovers: await db.leftovers.toArray(),
    }),
    [],
  );
  if (!data) return null;
  const shelved = data.leftovers.filter((l) => l.shelvedAt);
  const open = data.tracks.find((t) => t.id === openId);

  if (open) {
    return <TrackDetail track={open} steps={data.steps.filter((s) => s.trackId === open.id)} onBack={() => setOpenId(null)} />;
  }

  const lastDone = lastDoneByTrack(data.plans, data.steps);
  const active = data.tracks.filter((t) => !t.archivedAt);
  const archived = data.tracks.filter((t) => t.archivedAt);

  return (
    <>
      <h1 className="title">取り組み</h1>
      <div className="seg" role="tablist">
        <button role="tab" aria-pressed={tab === 'tracks'} aria-selected={tab === 'tracks'} onClick={() => setTab('tracks')}>
          取り組み
        </button>
        <button role="tab" aria-pressed={tab === 'shelf'} aria-selected={tab === 'shelf'} onClick={() => setTab('shelf')}>
          保留{shelved.length ? `（${shelved.length}）` : ''}
        </button>
      </div>

      {tab === 'tracks' ? (
        <>
          {active.map((t) => (
            <TrackCard
              key={t.id}
              track={t}
              steps={data.steps.filter((s) => s.trackId === t.id)}
              lastDoneAt={lastDone[t.id]}
              today={today}
              onOpen={() => setOpenId(t.id)}
            />
          ))}
          <button className="btn" onClick={() => setAdding(true)}>
            取り組みを追加
          </button>
          {archived.length > 0 && (
            <div className="stack">
              <span className="section-label">終了した取り組み</span>
              {archived.map((t) => (
                <div key={t.id} className="card-tight row" style={{ justifyContent: 'space-between', flexDirection: 'row' }}>
                  <span className="muted">{t.name}</span>
                  <button className="btn-ghost" onClick={() => archiveTrack(t.id, false)}>
                    元に戻す
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <Shelf leftovers={shelved} tracks={data.tracks} today={today} />
      )}

      {adding && <AddTrackSheet onClose={() => setAdding(false)} />}
    </>
  );
}

function TrackCard({ track, steps, lastDoneAt, today, onOpen }: {
  track: Track;
  steps: Step[];
  lastDoneAt?: string;
  today: string;
  onOpen: () => void;
}) {
  const sorted = steps.slice().sort((a, b) => a.order - b.order);
  const nextTitle = sorted.find((s) => s.status === 'todo')?.title;
  const stalled = isStalled(track, lastDoneAt, today);
  return (
    <button className="card" style={{ border: 0, textAlign: 'left', width: '100%' }} onClick={onOpen}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{track.name}</span>
        <span className="small muted">{track.type === 'project' ? 'プロジェクト' : '習慣'}</span>
      </div>
      {/* 進み具合のグラフは「記録」タブへ。ここは決める・直すための一覧 */}
      <span className="small muted">
        {track.type === 'project'
          ? `${nextTitle ? `次：${nextTitle}・` : ''}ステップ ${sorted.filter((s) => s.status === 'done').length} / ${sorted.length} 完了`
          : `いつもの長さ ${track.defaultMinutes ?? 60}分${track.defaultFirstStep ? `・最初の一手：${track.defaultFirstStep}` : ''}`}
      </span>
      {stalled && (
        <span className="small muted">
          最後に触ってから {daysSinceTouched(track, lastDoneAt, today)}日{track.lastNote ? `・前回：${track.lastNote.text}` : ''}
        </span>
      )}
    </button>
  );
}

function Shelf({ leftovers, tracks, today }: { leftovers: Leftover[]; tracks: Track[]; today: string }) {
  if (!leftovers.length) return <p className="sub">保留中のやり残しはありません。3日を過ぎたやり残しがここに移ります。</p>;
  return (
    <div className="stack">
      {leftovers
        .slice()
        .sort((a, b) => b.fromLifeDate.localeCompare(a.fromLifeDate))
        .map((l) => (
          <div key={l.id} className="card" style={{ gap: 6 }}>
            <span className="small muted">
              {tracks.find((t) => t.id === l.item.trackId)?.name ?? ''}・{formatLifeDateJa(l.fromLifeDate)}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{l.item.title}</span>
            <div className="row">
              <button className="btn" style={{ flex: 1 }} onClick={() => restoreLeftover(l.id, today)}>
                候補に戻す
              </button>
              <button className="btn-ghost" onClick={() => deleteLeftover(l.id)}>
                削除
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

function AddTrackSheet({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(emptyTrackForm);
  const submit = async () => {
    const { input, steps } = trackFormToInput(value);
    await createTrack(input, steps);
    onClose();
  };
  return (
    <Sheet onClose={onClose} label="取り組みを追加">
      <div style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
        <TrackForm value={value} onChange={setValue} />
      </div>
      <button className="btn-primary" disabled={!isTrackFormValid(value)} onClick={submit}>
        追加する
      </button>
      <button className="btn-ghost" onClick={onClose}>
        やめる
      </button>
    </Sheet>
  );
}

function TrackDetail({ track, steps, onBack }: { track: Track; steps: Step[]; onBack: () => void }) {
  const [name, setName] = useState(track.name);
  const [newStep, setNewStep] = useState({ title: '', minutes: 45, firstStep: '' });
  const sorted = steps.slice().sort((a, b) => a.order - b.order);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn-ghost" onClick={onBack}>
          戻る
        </button>
        <span className="small muted">{track.type === 'project' ? 'プロジェクト型' : '習慣型'}</span>
      </div>
      <div className="field">
        <span>種類</span>
        <div className="seg" role="group" aria-label="種類">
          {(['habit', 'project'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={track.type === t}
              onClick={() => {
                if (track.type === t) return;
                if (window.confirm(`「${track.name}」を${t === 'habit' ? '習慣型' : 'プロジェクト型'}に変えますか？${t === 'habit' ? 'ステップは消えずに残ります。' : ''}`)) {
                  void changeTrackType(track.id, t);
                }
              }}
            >
              {t === 'habit' ? '習慣型' : 'プロジェクト型'}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>名前</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== track.name && updateTrack(track.id, { name: name.trim() })}
        />
      </label>

      {track.type === 'habit' ? (
        <div className="card">
          <label className="field">
            <span>いつもの所要時間</span>
            <MinutesSelect value={track.defaultMinutes ?? 60} onChange={(m) => updateTrack(track.id, { defaultMinutes: m })} />
          </label>
          <label className="field">
            <span>いつもの最初の一手</span>
            <input
              className="input"
              defaultValue={track.defaultFirstStep ?? ''}
              onBlur={(e) => updateTrack(track.id, { defaultFirstStep: e.target.value.trim() || undefined })}
            />
          </label>
        </div>
      ) : (
        <div className="stack">
          <span className="section-label">ステップ</span>
          {sorted.map((s, i) => (
            <StepRow key={s.id} step={s} first={i === 0} />
          ))}
          <div className="card" style={{ border: '1px dashed var(--line)' }}>
            <span className="label">ステップを追加</span>
            <input className="input" aria-label="新しいステップの内容" placeholder="内容" value={newStep.title} onChange={(e) => setNewStep({ ...newStep, title: e.target.value })} />
            <div className="row">
              <span className="sub" style={{ flex: 'none' }}>所要時間</span>
              <MinutesSelect value={newStep.minutes} onChange={(m) => setNewStep({ ...newStep, minutes: m })} />
            </div>
            <input className="input" aria-label="新しいステップの最初の一手" placeholder="最初の一手" value={newStep.firstStep} onChange={(e) => setNewStep({ ...newStep, firstStep: e.target.value })} />
            <button
              className="btn"
              disabled={!newStep.title.trim()}
              onClick={async () => {
                await addStep(track.id, { title: newStep.title.trim(), minutes: newStep.minutes, firstStep: newStep.firstStep.trim() });
                setNewStep({ title: '', minutes: newStep.minutes, firstStep: '' });
              }}
            >
              追加
            </button>
          </div>
        </div>
      )}

      {track.lastNote && (
        <div className="card-tight">
          <span className="small muted">前回の続き</span>
          <span>{track.lastNote.text}</span>
        </div>
      )}

      <button
        className="btn"
        onClick={async () => {
          if (window.confirm(`「${track.name}」を終了しますか？候補に出なくなります（記録は残ります）。`)) {
            await archiveTrack(track.id, true);
            onBack();
          }
        }}
      >
        この取り組みを終了する（記録は残す）
      </button>
      <button
        className="btn-ghost"
        style={{ color: 'var(--warn)', alignSelf: 'center' }}
        onClick={async () => {
          if (
            window.confirm(
              `「${track.name}」を削除しますか？\nステップ、カレンダーに置いた予定（済の記録も含む）、やり残しもすべて消え、元に戻せません。\n記録を残したい場合は「終了する」を使ってください。`,
            )
          ) {
            await deleteTrack(track.id);
            onBack();
          }
        }}
      >
        この取り組みを削除する
      </button>
    </>
  );
}

function StepRow({ step, first }: { step: Step; first: boolean }) {
  const done = step.status === 'done';
  return (
    <div className="card" style={{ gap: 8, opacity: done ? 0.6 : 1 }}>
      <div className="row">
        <input
          className="input"
          aria-label="ステップの内容"
          defaultValue={step.title}
          disabled={done}
          onBlur={(e) => e.target.value.trim() && updateStep(step.id, { title: e.target.value.trim() })}
        />
        {done ? (
          <span className="stamp" style={{ flex: 'none' }}>済</span>
        ) : (
          <button className="btn-icon" aria-label="ひとつ前へ" disabled={first} onClick={() => moveStepUp(step.id)}>
            ↑
          </button>
        )}
      </div>
      {!done && (
        <>
          <div className="row">
            <span className="sub" style={{ flex: 'none' }}>所要時間</span>
            <MinutesSelect value={step.minutes} onChange={(m) => updateStep(step.id, { minutes: m })} />
          </div>
          <input
            className="input"
            aria-label="最初の一手"
            placeholder="最初の一手"
            defaultValue={step.firstStep}
            onBlur={(e) => updateStep(step.id, { firstStep: e.target.value.trim() })}
          />
          <button
            className="btn-ghost"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => window.confirm('このステップを削除しますか？') && deleteStep(step.id)}
          >
            削除
          </button>
        </>
      )}
    </div>
  );
}
