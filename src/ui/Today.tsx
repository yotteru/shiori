import { useState } from 'react';
import { useLive } from '../hooks';
import { markDone, revertDone } from '../lib/actions';
import { nowIso, toDate } from '../lib/clock';
import { db } from '../lib/db';
import { addDays, diffDays, formatLifeDateJa, jstTime, lifeDate, weekStartMonday } from '../lib/lifeDate';
import { assignTimes } from '../lib/schedule';
import type { Plan, PlanItem, Step, Track } from '../lib/types';
import { Sheet, Toast, useLongPress } from './common';
import { useDraft } from './useDraft';

// 今日のしおり（案2-B、§3.3）

function ago(at: string, today: string): string {
  const d = diffDays(lifeDate(toDate(at)), today);
  return d <= 0 ? '今日' : `${d}日前`;
}

export function Today({ plan, today, tracks, steps, plans }: {
  plan: Plan;
  today: string;
  tracks: Track[];
  steps: Step[];
  plans: Plan[];
}) {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const times = plan.source === 'night' ? assignTimes(plan.window.start, plan.items.map((i) => i.minutes)) : [];
  const nextIndex = plan.items.findIndex((i) => i.status === 'planned');
  const doneCount = plan.items.filter((i) => i.status === 'done').length;
  const [sheetFor, setSheetFor] = useState<PlanItem | null>(null);
  const [toast, setToast] = useState<{ message: string; undoId?: string } | null>(null);

  const label = (i: number, item: PlanItem) => {
    const name = trackById.get(item.trackId)?.name ?? '';
    return times[i] ? `${times[i]}・${name}` : name;
  };

  return (
    <>
      <div className="head-row">
        <div className="head">
          <span className="sub">
            {formatLifeDateJa(today)}・{plan.source === 'night' ? '前の晩に組んだルート' : '当日に組んだルート'}
          </span>
          <h1 className="title">今日のしおり</h1>
        </div>
        <span className="mono" style={{ fontSize: 20, fontWeight: 600 }} aria-label={`済 ${doneCount} 件、全 ${plan.items.length} 件`}>
          {doneCount} / {plan.items.length}
        </span>
      </div>

      <Dots items={plan.items} nextIndex={nextIndex} />

      {plan.items.map((item, i) => {
        if (item.status === 'done') {
          return (
            <DoneCard
              key={item.id}
              label={label(i, item)}
              item={item}
              onRevert={async () => {
                await revertDone(plan.lifeDate, item.id);
                setToast({ message: '未に戻しました' });
              }}
            />
          );
        }
        if (i === nextIndex) {
          return (
            <NextCard
              key={item.id}
              plan={plan}
              item={item}
              time={times[i]}
              track={trackById.get(item.trackId)}
              today={today}
              onMark={() => setSheetFor(item)}
            />
          );
        }
        return (
          <div key={item.id} className="card-tight" style={item.status === 'undone' ? { opacity: 0.6 } : undefined}>
            <span className="small muted">
              {label(i, item)}
              {item.status === 'undone' ? '・未' : ''}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{item.title}</span>
            {item.firstStep && item.status === 'planned' && <span className="first-step">最初の一手：{item.firstStep}</span>}
          </div>
        );
      })}

      {nextIndex < 0 && doneCount > 0 && <p className="sub center">今日のルートはここまでです。</p>}

      <Filled plan={plan} today={today} tracks={tracks} steps={steps} plans={plans} />

      {sheetFor && (
        <DoneSheet
          item={sheetFor}
          lifeDate={plan.lifeDate}
          onClose={() => setSheetFor(null)}
          onDone={() => {
            setToast({ message: '済をつけました', undoId: sheetFor.id });
            setSheetFor(null);
          }}
        />
      )}
      {toast && (
        <Toast
          message={toast.message}
          action={toast.undoId ? '取り消す' : undefined}
          onAction={async () => {
            if (toast.undoId) await revertDone(plan.lifeDate, toast.undoId);
            setToast(null);
          }}
          onTimeout={() => setToast(null)}
        />
      )}
    </>
  );
}

function Dots({ items, nextIndex }: { items: PlanItem[]; nextIndex: number }) {
  return (
    <div className="dots" aria-hidden="true">
      {items.map((item, i) => {
        const cls = item.status === 'done' ? 'dot-done' : i === nextIndex ? 'dot-next' : item.status === 'undone' ? 'dot-undone' : 'dot-todo';
        return (
          <span key={item.id} style={{ display: 'contents' }}>
            {i > 0 && <span className={`dot-line${items[i - 1].status === 'done' ? ' on' : ''}`} />}
            <span className={`dot ${cls}`}>{item.status === 'done' ? '✓' : i + 1}</span>
          </span>
        );
      })}
    </div>
  );
}

function DoneCard({ label, item, onRevert }: { label: string; item: PlanItem; onRevert: () => void }) {
  const press = useLongPress(onRevert);
  return (
    <div className="done-card" {...press} aria-label={`${item.title}（済）。長押しで未に戻せます`}>
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="small muted">{label}</span>
        <span className="t">{item.title}</span>
      </div>
      <span className="stamp">{item.doneAt ? jstTime(toDate(item.doneAt)) : ''} 済</span>
    </div>
  );
}

function NextCard({ plan, item, time, track, today, onMark }: {
  plan: Plan;
  item: PlanItem;
  time?: string;
  track?: Track;
  today: string;
  onMark: () => void;
}) {
  const key = `started:${plan.lifeDate}:${item.id}`;
  const started = useLive(() => db.drafts.get(key), [key]);
  const start = () => db.drafts.put({ key, value: nowIso(), updatedAt: nowIso() });

  return (
    <section className="next-card" aria-label="次の行き先">
      <span className="kicker">次の行き先{time ? `・${time}` : ''}</span>
      <span className="t">{item.title}</span>
      {item.firstStep && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="cap">{plan.source === 'night' ? '昨夜の自分が決めた最初の一手' : '最初の一手'}</span>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{item.firstStep}</span>
        </div>
      )}
      {track?.lastNote && (
        <div className="note">
          <span className="cap">前回の続き（{ago(track.lastNote.at, today)}）</span>
          <span>{track.lastNote.text}</span>
        </div>
      )}
      {started ? (
        <span className="cap">{jstTime(toDate(started.value))} に始めました</span>
      ) : (
        <button className="btn-next" onClick={start}>
          最初の一手を始める
        </button>
      )}
      <button className="btn-mark" onClick={onMark}>
        済をつける
      </button>
    </section>
  );
}

function DoneSheet({ item, lifeDate: ld, onClose, onDone }: { item: PlanItem; lifeDate: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote, clearDraft] = useDraft(`next-note:${ld}:${item.id}`);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await markDone(ld, item.id, note);
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

/** 今日埋まった空白：習慣型は今週7マス、プロジェクト型は完了数 / 全ステップ数 */
function Filled({ plan, today, tracks, steps, plans }: { plan: Plan; today: string; tracks: Track[]; steps: Step[]; plans: Plan[] }) {
  const doneTrackIds = Array.from(new Set(plan.items.filter((i) => i.status === 'done').map((i) => i.trackId)));
  const rows = doneTrackIds.map((id) => tracks.find((t) => t.id === id)).filter((t): t is Track => !!t);
  if (!rows.length) return null;
  const monday = weekStartMonday(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const doneOn = (trackId: string, d: string) =>
    plans.some((p) => p.lifeDate === d && p.items.some((i) => i.trackId === trackId && i.status === 'done'));

  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <span className="section-label">今日埋まった空白</span>
      <div className="card" style={{ padding: '14px 16px' }}>
        {rows.map((t) =>
          t.type === 'habit' ? (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>{t.name}・今週</span>
              <div className="squares" role="img" aria-label={`今週 ${week.filter((d) => doneOn(t.id, d)).length} 日`}>
                {week.map((d) => (
                  <span key={d} className={`sq${doneOn(t.id, d) ? ' on' : ''}${d === today ? ' today' : ''}`} />
                ))}
              </div>
            </div>
          ) : (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>{t.name}</span>
              <span className="mono muted" style={{ fontSize: 13 }}>
                {steps.filter((s) => s.trackId === t.id && s.status === 'done').length} / {steps.filter((s) => s.trackId === t.id).length}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
