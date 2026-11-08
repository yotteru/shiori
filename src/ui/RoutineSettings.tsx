import { useState } from 'react';
import { useLive } from '../hooks';
import { DEFAULT_VIEW, formatDuration, formatMinute } from '../lib/calendar';
import { addRoutine, deleteRoutine, setCalendarView, updateRoutine } from '../lib/calendarActions';
import { db, getMeta } from '../lib/db';
import type { Routine } from '../lib/types';
import { MinutesSelect, TimeSelect } from './common';

// 設定：いつもの固定とカレンダーの表示（2026-11-08）

const WD = '日月火水木金土';
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

export function RoutineSettings() {
  const routines = useLive(() => db.routines.orderBy('id').toArray(), []);
  const [adding, setAdding] = useState(false);
  if (!routines) return null;
  const sorted = routines.slice().sort((a, b) => a.start - b.start);
  return (
    <div className="card">
      <span className="label">いつもの固定</span>
      <span className="sub">
        仕事・食事・風呂など。曜日に合わせて毎日カレンダーの左の列に自動で置かれます。ここで変えると今日以降のすべての日に反映されます（その日に自分で動かした・外した固定はそのまま）。
      </span>
      {sorted.map((r) => (
        <RoutineRow key={r.id} r={r} />
      ))}
      {adding ? (
        <NewRoutine onDone={() => setAdding(false)} />
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          いつもの固定を追加
        </button>
      )}
    </div>
  );
}

function DaysPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <>
      <div className="days7">
        {ORDER.map((w) => (
          <button key={w} aria-pressed={days.includes(w)} onClick={() => onChange(days.includes(w) ? days.filter((x) => x !== w) : [...days, w])}>
            {WD[w]}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="chip-btn" onClick={() => onChange([1, 2, 3, 4, 5])}>
          平日
        </button>
        <button className="chip-btn" onClick={() => onChange([0, 6])}>
          休日
        </button>
        <button className="chip-btn" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>
          毎日
        </button>
      </div>
    </>
  );
}

function RoutineRow({ r }: { r: Routine }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(r.title);
  const label = r.days.length === 7 ? '毎日' : r.days.length === 5 && [1, 2, 3, 4, 5].every((d) => r.days.includes(d)) ? '平日' : r.days.length === 2 && r.days.includes(0) && r.days.includes(6) ? '休日' : ORDER.filter((d) => r.days.includes(d)).map((d) => WD[d]).join('');
  return (
    <div className="card" style={{ border: '1px solid var(--line-soft)', padding: 10, gap: 8 }}>
      <button className="row" style={{ justifyContent: 'space-between', border: 0, background: 'transparent', padding: 0, minHeight: 36, width: '100%', textAlign: 'left' }} onClick={() => setOpen(!open)}>
        <b>{r.title}</b>
        <span className="small muted mono">
          {formatMinute(r.start)}–{formatMinute(r.start + r.min)}・{label || '曜日なし'}
        </span>
      </button>
      {open && (
        <>
          <label className="field">
            <span>名前</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && updateRoutine(r.id, { title: title.trim() })} />
          </label>
          <div className="row">
            <TimeSelect label="開始" value={formatMinute(r.start)} onChange={(v) => updateRoutine(r.id, { start: toMin(v) })} />
            <MinutesSelect value={r.min} onChange={(m) => updateRoutine(r.id, { min: m })} />
          </div>
          <DaysPicker days={r.days} onChange={(d) => updateRoutine(r.id, { days: d })} />
          <button className="btn-ghost" style={{ alignSelf: 'flex-start', color: 'var(--warn)' }} onClick={() => deleteRoutine(r.id)}>
            このいつもの固定を削除
          </button>
        </>
      )}
    </div>
  );
}

function NewRoutine({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('12:00');
  const [min, setMin] = useState(60);
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  return (
    <div className="card" style={{ border: '1px dashed var(--line)', padding: 10, gap: 8 }}>
      <input className="input" value={title} placeholder="例：仕事、夕食、風呂" onChange={(e) => setTitle(e.target.value)} />
      <div className="row">
        <TimeSelect label="開始" value={start} onChange={setStart} />
        <MinutesSelect value={min} onChange={setMin} />
      </div>
      <DaysPicker days={days} onChange={setDays} />
      <div className="row">
        <button
          className="btn"
          style={{ flex: 1 }}
          disabled={!title.trim() || days.length === 0}
          onClick={async () => {
            await addRoutine({ title: title.trim(), start: toMin(start), min, days });
            onDone();
          }}
        >
          追加
        </button>
        <button className="btn-ghost" onClick={onDone}>
          やめる
        </button>
      </div>
    </div>
  );
}

/** カレンダーに表示する時間帯と、開いたときの位置（端末ごと） */
export function CalendarViewSettings() {
  const meta = useLive(() => getMeta(), []);
  if (!meta) return null;
  const v = meta.calendarView ?? DEFAULT_VIEW;
  const opts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const label = (h: number) => (h >= 24 ? `翌${h - 24}:00` : `${h}:00`);
  return (
    <div className="card">
      <span className="label">カレンダーの表示</span>
      <span className="sub">
        初期値は 6:00〜24:00、開いたときは 8:00 の位置から（今日は「いま」の少し前から）。合計 {formatDuration((v.end - v.start) * 60)}。
      </span>
      <div className="row">
        <select className="select mono" aria-label="表示の開始" value={v.start} onChange={(e) => setCalendarView({ ...v, start: Number(e.target.value) })}>
          {opts(0, 23).map((h) => (
            <option key={h} value={h}>
              {label(h)}
            </option>
          ))}
        </select>
        <span className="muted">〜</span>
        <select className="select mono" aria-label="表示の終了" value={v.end} onChange={(e) => setCalendarView({ ...v, end: Number(e.target.value) })}>
          {opts(v.start + 1, 28).map((h) => (
            <option key={h} value={h}>
              {label(h)}
            </option>
          ))}
        </select>
      </div>
      <label className="row" style={{ justifyContent: 'space-between' }}>
        <span className="sub">開いたときの位置</span>
        <select className="select mono" style={{ maxWidth: 140 }} value={v.focus} onChange={(e) => setCalendarView({ ...v, focus: Number(e.target.value) })}>
          {opts(v.start, v.end - 1).map((h) => (
            <option key={h} value={h}>
              {label(h)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
