import { useState } from 'react';
import { useLive } from '../hooks';
import { DEFAULT_VIEW, fixedBlocksFor, formatDuration, formatMinute } from '../lib/calendar';
import { addAllDayFixed, addExtraFixed, removeExtraFixed, setHoliday, toggleIntent } from '../lib/calendarActions';
import { db, getMeta } from '../lib/db';
import { formatLifeDateJa, weekday } from '../lib/lifeDate';
import type { Plan, Track } from '../lib/types';
import { allDayEvents, allocation, defaultWeekOffset, freeMinutes, isHoliday, weekDates } from '../lib/week';
import { Sheet } from './common';

// しおりタブの「週」（2026-11-09。要件メモ「週の見通しと振り返り」）。
// 月〜日の見通し：決まっている予定と「この日にやること」の札だけ。時刻つきの行き先は前の晩に置く

const WD = ['月', '火', '水', '木', '金', '土', '日'];
const PX_PER_HOUR = 16;
const MODE_KEY = 'shiori-week-mode';

function loadMode(): 'cal' | 'list' {
  try {
    return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'cal';
  } catch {
    return 'cal';
  }
}

const dayNum = (d: string) => Number(d.slice(8, 10));
const md = (d: string) => `${Number(d.slice(5, 7))}月${dayNum(d)}日`;
const hours = (min: number) => `${Math.round(min / 30) / 2}h`;

export function WeekView({ today, hourJst, header }: { today: string; hourJst: number; header: React.ReactNode }) {
  const [offset, setOffset] = useState(() => defaultWeekOffset(today, hourJst));
  const [mode, setModeState] = useState<'cal' | 'list'>(loadMode);
  const [open, setOpen] = useState<string | null>(null);
  const dates = weekDates(today, offset);
  const data = useLive(
    async () => ({
      plans: await db.plans.where('lifeDate').between(dates[0], dates[6], true, true).toArray(),
      routines: await db.routines.toArray(),
      tracks: (await db.tracks.orderBy('createdAt').toArray()).filter((t) => !t.archivedAt && t.type !== 'number'),
      view: (await getMeta()).calendarView ?? DEFAULT_VIEW,
    }),
    [dates[0]],
  );
  const setMode = (m: 'cal' | 'list') => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // 覚えられなくても表示はできる
    }
  };
  if (!data) return null;
  const planOf = (d: string) => data.plans.find((p) => p.lifeDate === d);
  const trackById = new Map(data.tracks.map((t) => [t.id, t]));
  const alloc = allocation(data.plans, dates);
  const label = offset === 0 ? '今週' : offset === 1 ? '来週' : offset === -1 ? '先週' : offset > 0 ? `${offset}週あと` : `${-offset}週まえ`;

  return (
    <>
      {header}
      <div className="weekbar">
        <button className="btn-icon" aria-label="前の週" disabled={offset <= -4} onClick={() => setOffset(offset - 1)}>
          ‹
        </button>
        <div className="stack" style={{ gap: 0, alignItems: 'center' }}>
          <span className="small muted">{label}</span>
          <h1 className="title" style={{ fontSize: 20 }}>
            {md(dates[0])}〜{dayNum(dates[6])}日
          </h1>
        </div>
        <button className="btn-icon" aria-label="次の週" disabled={offset >= 4} onClick={() => setOffset(offset + 1)}>
          ›
        </button>
      </div>

      {data.tracks.length > 0 && (
        <div className="card" aria-label="この週にやる日">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">この週にやる日</span>
            <span className="small muted">札を付けた日</span>
          </div>
          <div className="alloc">
            {data.tracks.map((t) => {
              const row = alloc[t.id] ?? Array(7).fill(false);
              const n = row.filter(Boolean).length;
              return (
                <div key={t.id} className="alloc-row">
                  <span className="nm">
                    {t.name}
                    {n ? `（${n}日）` : ''}
                  </span>
                  <span className="days">
                    {row.map((on, i) => (
                      <span key={i} className={`d${on ? (t.type === 'habit' ? ' on h' : ' on p') : ''}`}>
                        {WD[i]}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="seg seg-small" role="group" aria-label="週の表示">
        <button aria-pressed={mode === 'cal'} onClick={() => setMode('cal')}>
          カレンダーで見る
        </button>
        <button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
          リストで見る
        </button>
      </div>

      {mode === 'cal' ? (
        <WeekCalendar dates={dates} today={today} planOf={planOf} routines={data.routines} view={data.view} trackById={trackById} onOpen={setOpen} />
      ) : (
        <div className="stack">
          {dates.map((d, i) => {
            const p = planOf(d);
            const hol = isHoliday(d, p);
            const fixed = fixedBlocksFor(d, data.routines, p);
            const allDay = allDayEvents(p);
            const free = freeMinutes(d, data.routines, p, data.view);
            return (
              <button key={d} className={`wk-day${d < today ? ' past' : ''}${d === today ? ' today' : ''}`} onClick={() => setOpen(d)} aria-label={`${formatLifeDateJa(d)}を開く`}>
                <span className="dt">
                  <b className="mono">{dayNum(d)}</b>
                  <span className={hol ? 'hol' : ''}>
                    {WD[i]}
                    {d === today ? '・今日' : ''}
                  </span>
                </span>
                <span className="mid">
                  <span className="fx">
                    {hol && <span className="tag-hol">休日</span>}
                    {[...allDay.map((x) => `${x.title} 終日`), ...fixed.map((f) => `${f.title} ${formatMinute(f.start)}–${formatMinute(f.start + f.min)}`)].join('・') || (hol ? '決まった予定なし' : '')}
                  </span>
                  <span className="chips">
                    {(p?.intents ?? []).length ? (
                      (p?.intents ?? []).map((id) => {
                        const t = trackById.get(id);
                        return t ? (
                          <span key={id} className={`chip${t.type === 'habit' ? ' h' : ''}`}>
                            {t.name}
                          </span>
                        ) : null;
                      })
                    ) : (
                      <span className="chip empty">＋ やることの札</span>
                    )}
                  </span>
                </span>
                <span className="free">
                  空き<b className="mono">{formatDuration(free)}</b>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <span className="small muted">日をタップすると、予定・休日・札を決められます。時刻つきで行き先を置くのは、今までどおり前の晩（明日の画面）です。</span>

      {open && <DaySheet date={open} plan={planOf(open)} routines={data.routines} tracks={data.tracks} onClose={() => setOpen(null)} />}
    </>
  );
}

function WeekCalendar({
  dates,
  today,
  planOf,
  routines,
  view,
  trackById,
  onOpen,
}: {
  dates: string[];
  today: string;
  planOf: (d: string) => Plan | undefined;
  routines: Parameters<typeof fixedBlocksFor>[1];
  view: { start: number; end: number };
  trackById: Map<string, Track>;
  onOpen: (d: string) => void;
}) {
  const H = (view.end - view.start) * PX_PER_HOUR;
  const y = (min: number) => ((min - view.start * 60) / 60) * PX_PER_HOUR;
  const ticks: number[] = [];
  for (let h = view.start; h <= view.end; h += 3) ticks.push(h);
  return (
    <div>
      <div className="wcal">
        <span />
        {dates.map((d, i) => {
          const p = planOf(d);
          const hol = isHoliday(d, p);
          return (
            <button key={d} className={`wc-head${d === today ? ' today' : ''}${d < today ? ' past' : ''}`} onClick={() => onOpen(d)} aria-label={`${formatLifeDateJa(d)}を開く`}>
              <b>{dayNum(d)}</b>
              <span className={hol ? 'hol' : ''}>{WD[i]}</span>
              <span className="wc-tags">
                {(p?.intents ?? []).map((id) => {
                  const t = trackById.get(id);
                  return t ? (
                    <i key={id} className={t.type === 'habit' ? 'h' : 'p'}>
                      {t.name}
                    </i>
                  ) : null;
                })}
              </span>
            </button>
          );
        })}
        <div className="wc-axis" style={{ height: H }}>
          {ticks.map((h) => (
            <span key={h} style={{ top: y(h * 60) }}>
              {h >= 24 ? h - 24 : h}
            </span>
          ))}
        </div>
        {dates.map((d) => {
          const p = planOf(d);
          const allDay = allDayEvents(p);
          const free = freeMinutes(d, routines, p, view);
          const blocks = [
            ...fixedBlocksFor(d, routines, p).map((f) => ({ key: f.id, title: f.title, start: f.start, min: f.min, cls: f.extraId ? 'ev' : 'fix' })),
            ...allDay.map((x) => ({ key: x.id, title: `${x.title}（終日）`, start: view.start * 60, min: (view.end - view.start) * 60, cls: 'ev' })),
            ...(p?.items ?? [])
              .filter((it) => typeof it.start === 'number')
              .map((it) => ({ key: it.id, title: it.title, start: it.start!, min: it.minutes, cls: trackById.get(it.trackId)?.type === 'habit' ? 'it h' : 'it p' })),
          ];
          return (
            <button
              key={d}
              className={`wc-col${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}
              style={{ height: H }}
              onClick={() => onOpen(d)}
              aria-label={`${formatLifeDateJa(d)} 空き ${formatDuration(free)}`}
            >
              {blocks.map((b) => {
                const s = Math.max(b.start, view.start * 60);
                const e = Math.min(b.start + b.min, view.end * 60);
                if (e <= s) return null;
                return (
                  <span key={b.key} className={`wc-blk ${b.cls}`} style={{ top: y(s), height: Math.max(6, ((e - s) / 60) * PX_PER_HOUR - 1) }}>
                    {e - s >= 90 ? b.title : ''}
                  </span>
                );
              })}
            </button>
          );
        })}
        <span />
        {dates.map((d) => (
          <span key={d} className="wc-free">
            空き<b className="mono">{hours(freeMinutes(d, routines, planOf(d), view))}</b>
          </span>
        ))}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--surface)', border: '1px solid var(--line-soft)' }} />
          空き
        </span>
        <span>
          <i style={{ background: 'var(--track)' }} />
          いつもの固定
        </span>
        <span>
          <i style={{ background: '#9aa3ae' }} />
          その日だけの予定
        </span>
        <span>
          <i style={{ background: '#fdebdf', border: '1px solid #c2410c' }} />
          置いた行き先
        </span>
        <span>上の札＝その日にやること（時刻なし）</span>
      </div>
    </div>
  );
}

/** 日のシート：休日・その日だけの予定・やることの札 */
function DaySheet({ date, plan, routines, tracks, onClose }: { date: string; plan?: Plan; routines: Parameters<typeof fixedBlocksFor>[1]; tracks: Track[]; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(10 * 60);
  const [end, setEnd] = useState(11 * 60);
  const wd = weekday(date);
  const weekend = wd === 0 || wd === 6;
  const routineBlocks = fixedBlocksFor(date, routines, plan).filter((f) => f.routineId);
  const extras = plan?.extraFixed ?? [];
  const intents = plan?.intents ?? [];
  const starts: number[] = [];
  for (let m = 0; m <= 23 * 60 + 30; m += 15) starts.push(m);
  const ends: number[] = [];
  for (let m = start + 30; m <= 24 * 60; m += 15) ends.push(m);

  const add = async () => {
    if (!title.trim()) return;
    if (allDay) await addAllDayFixed(date, title.trim());
    else await addExtraFixed(date, title.trim(), start, Math.max(30, end - start), 'night');
    setTitle('');
  };

  return (
    <Sheet onClose={onClose} label={formatLifeDateJa(date)}>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{formatLifeDateJa(date)}</span>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={weekend || !!plan?.holiday} disabled={weekend} onChange={(e) => setHoliday(date, e.target.checked, 'night')} />
        <span>{weekend ? '土日は休日です' : 'この日は休日として扱う（祝日・有休）'}</span>
      </label>

      <div className="card">
        <span className="label">決まっている予定</span>
        <span className="small muted">
          いつもの固定：{routineBlocks.length ? routineBlocks.map((f) => `${f.title} ${formatMinute(f.start)}–${formatMinute(f.start + f.min)}`).join('・') : 'なし'}
        </span>
        {extras.map((x) => (
          <div key={x.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              <b>{x.title}</b>{' '}
              <span className="small muted mono">{x.allDay ? '終日' : `${formatMinute(x.start)}–${formatMinute(x.start + x.min)}`}</span>
            </span>
            <button className="btn-ghost" aria-label={`${x.title}を消す`} onClick={() => removeExtraFixed(date, x.id)}>
              ✕
            </button>
          </div>
        ))}
        <input className="input" value={title} placeholder="例：歯医者、飲み会、出張" aria-label="予定の名前" onChange={(e) => setTitle(e.target.value)} />
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>終日</span>
        </label>
        {!allDay && (
          <div className="row">
            <select
              className="select"
              aria-label="開始"
              value={start}
              onChange={(e) => {
                const s = Number(e.target.value);
                setStart(s);
                if (end < s + 30) setEnd(Math.min(24 * 60, s + 60));
              }}
            >
              {starts.map((m) => (
                <option key={m} value={m}>
                  {formatMinute(m)}
                </option>
              ))}
            </select>
            <span className="small muted">〜</span>
            <select className="select" aria-label="終わり" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {ends.map((m) => (
                <option key={m} value={m}>
                  {formatMinute(m)}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className="btn" disabled={!title.trim()} onClick={() => void add()}>
          予定を足す
        </button>
        <span className="small muted">TimeTree の予定のうち、空き時間に関わるものだけ入れておけば十分です（最小30分・15分刻み）。</span>
      </div>

      <div className="card">
        <span className="label">この日にやること（時刻は決めない）</span>
        {tracks.length === 0 && <span className="small muted">取り組みを作ると、ここで札を付けられます。</span>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {tracks.map((t) => {
            const on = intents.includes(t.id);
            return (
              <button key={t.id} className={`chip-btn${on ? (t.type === 'habit' ? ' tag-on-h' : ' tag-on-p') : ''}`} aria-pressed={on} onClick={() => toggleIntent(date, t.id)}>
                {on ? '✓ ' : ''}
                {t.name}
              </button>
            );
          })}
        </div>
        <span className="small muted">札を付けた取り組みは、前の晩にこの日を組むとき、候補の先頭に「札」の印つきで並びます。</span>
      </div>

      <button className="btn-primary" onClick={onClose}>
        閉じる
      </button>
    </Sheet>
  );
}
