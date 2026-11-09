import { useState } from 'react';
import { fixedBlocksFor, formatDuration, formatMinute } from '../lib/calendar';
import { addAllDayFixed, addExtraFixed, removeExtraFixed, setHoliday, toggleIntent } from '../lib/calendarActions';
import { formatLifeDateJa, weekday } from '../lib/lifeDate';
import type { Plan, Track } from '../lib/types';
import { allDayEvents, allocation, freeMinutes, isHoliday } from '../lib/week';
import { EndSelect, formatEnd, Sheet } from './common';

// しおりタブの「週」（2026-11-09。要件メモ「週の見通しと振り返り」）。
// 月〜日の見通し：決まっている予定と「この日にやること」の札だけ。時刻つきの行き先は前の晩に置く

const WD = ['月', '火', '水', '木', '金', '土', '日'];
const PX_PER_HOUR = 16;
const MODE_KEY = 'shiori-week-mode';


const dayNum = (d: string) => d.slice(8, 10);
const hours = (min: number) => `${Math.round(min / 30) / 2}h`;

export function loadWeekMode(): 'cal' | 'list' {
  try {
    return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'cal';
  } catch {
    return 'cal';
  }
}

export function saveWeekMode(m: 'cal' | 'list') {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // 覚えられなくても表示はできる
  }
}

export function weekLabel(offset: number): string {
  return offset === 0 ? '今週' : offset === 1 ? '来週' : offset === -1 ? '先週' : offset > 0 ? `${offset}週あと` : `${-offset}週まえ`;
}

export function weekTitle(dates: string[]): string {
  return `${dates[0].slice(5, 7)}/${dates[0].slice(8, 10)}〜${dates[6].slice(5, 7)}/${dates[6].slice(8, 10)}`;
}

/** 下の操作エリアに出す「この週にやる日」（札を付けた曜日）。札がなければ空 */
export function allocationItems(plans: Plan[], dates: string[], tracks: Track[]) {
  const alloc = allocation(plans, dates);
  return tracks
    .map((t) => ({ track: t, days: (alloc[t.id] ?? []).map((on, i) => (on ? WD[i] : '')).filter(Boolean) }))
    .filter((x) => x.days.length > 0);
}

/**
 * 週の画面の中身（2026-11-09 に作り直し）。見出しと下の操作エリアは しおりタブ（DayView）が今日・明日と同じ形で持つ。
 * データは DayView が読んだものを受け取る（切り替えのたびに読み直さない）
 */
export function WeekBody({
  dates,
  today,
  plans,
  routines,
  tracks,
  view,
  mode,
  onOpen,
}: {
  dates: string[];
  today: string;
  plans: Plan[];
  routines: Parameters<typeof fixedBlocksFor>[1];
  tracks: Track[];
  view: { start: number; end: number };
  mode: 'cal' | 'list';
  onOpen: (d: string) => void;
}) {
  const planOf = (d: string) => plans.find((p) => p.lifeDate === d);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  return (
    <div className="stack" style={{ gap: 12 }}>
      {mode === 'cal' ? (
        <WeekCalendar dates={dates} today={today} planOf={planOf} routines={routines} view={view} trackById={trackById} onOpen={onOpen} />
      ) : (
        <div className="stack">
          {dates.map((d, i) => {
            const p = planOf(d);
            const hol = isHoliday(d, p);
            const fixed = fixedBlocksFor(d, routines, p);
            const allDay = allDayEvents(p);
            const free = freeMinutes(d, routines, p, view);
            return (
              <button key={d} className={`wk-day${d < today ? ' past' : ''}${d === today ? ' today' : ''}`} onClick={() => onOpen(d)} aria-label={`${formatLifeDateJa(d)}を開く`}>
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
    </div>
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
export function DaySheet({ date, plan, routines, tracks, onClose }: { date: string; plan?: Plan; routines: Parameters<typeof fixedBlocksFor>[1]; tracks: Track[]; onClose: () => void }) {
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
              <span className="small muted mono">{x.allDay ? '終日' : `${formatMinute(x.start)}–${formatEnd(x.start + x.min)}`}</span>
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
            <EndSelect start={start} value={end} onChange={setEnd} />
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
