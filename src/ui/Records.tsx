import { Fragment, useEffect, useState } from 'react';
import { useLive, useNow } from '../hooks';
import { formatDuration } from '../lib/calendar';
import { lastDoneByTrack } from '../lib/candidates';
import { db } from '../lib/db';
import { addDays, lifeDate } from '../lib/lifeDate';
import { weeklyHistory, weeklyStarts } from '../lib/records';
import { daysSinceTouched } from '../lib/tracks';
import type { ChangeNote, Journal, Measure, Plan, StartSession, Track } from '../lib/types';
import { addChange, deleteChange, measureSeries, plannedNights, timeline, weekFeel } from '../lib/reflection';
import { FEEL_LABEL } from './DoneSheet';
import { quickCount, weekDates, weekSquares, type Square } from '../lib/week';

// 記録タブ（2026-11-08）：眺める・振り返る場所。やった時間（始めた記録があれば実際の時間）と、始めた回数

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function Records() {
  const now = useNow();
  const today = lifeDate(now);
  const data = useLive(
    async () => ({
      plans: await db.plans.toArray(),
      tracks: await db.tracks.toArray(),
      steps: await db.steps.toArray(),
      starts: await db.starts.toArray(),
      journals: await db.journals.toArray(),
      changes: await db.changes.toArray(),
      measures: await db.measures.toArray(),
    }),
    [],
  );
  const [tip, setTip] = useState<{ x: number; y: number; value: string; label: string } | null>(null);
  useEffect(() => {
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, { passive: true });
    return () => window.removeEventListener('scroll', hide);
  }, []);
  if (!data) return null;

  const allTracks = data.tracks.filter((t) => !t.archivedAt);
  // 時間で数える取り組み（数値型は別のカードでグラフに）
  const tracks = allTracks.filter((t) => t.type !== 'number');
  const numberTracks = allTracks.filter((t) => t.type === 'number');
  const hist = weeklyHistory(data.plans, today, 8, data.starts);
  const counts = weeklyStarts(data.starts, hist.weeks);
  const startsThisWeek = (id: string) => counts.byTrack[id]?.[7] ?? 0;
  const thisWeek = (id: string) => hist.byTrack[id]?.[7] ?? 0;
  const ranked = tracks.slice().sort((a, b) => thisWeek(b.id) - thisWeek(a.id));
  const maxWeek = Math.max(60, ...ranked.map((t) => thisWeek(t.id)));
  const lastDone = lastDoneByTrack(data.plans, data.steps);
  const monday = hist.weeks[7];
  const labels = hist.weeks.map((w, i) => (i === 7 ? '今週' : shortDate(w)));
  const show = (e: React.PointerEvent | React.FocusEvent, value: string, label: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, value, label });
  };

  return (
    <div className="stack" style={{ gap: 12 }} onPointerDown={(e) => !(e.target as HTMLElement).closest('[data-tip]') && setTip(null)}>
      <h1 className="title">記録</h1>
      {allTracks.length > 0 && <WeekSquares today={today} tracks={allTracks} plans={data.plans} starts={data.starts} measures={data.measures} />}
      {allTracks.length === 0 && <p className="sub">取り組みを作って済をつけると、ここに時間が積み上がります。</p>}

      {tracks.length > 0 && (
        <section className="viz-card" aria-label="今週の時間">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">今週の時間</span>
            <span className="small muted mono">
              {shortDate(monday)}〜{shortDate(addDays(monday, 6))}
            </span>
          </div>
          <div className="hbars">
            {ranked.map((t) => {
              const v = thisWeek(t.id);
              return (
                <button
                  key={t.id}
                  className="hbar"
                  data-tip
                  aria-label={`${t.name} 今週 ${formatDuration(v)}`}
                  onPointerDown={(e) => show(e, formatDuration(v), `${t.name}・今週`)}
                  onFocus={(e) => show(e, formatDuration(v), `${t.name}・今週`)}
                >
                  <span className="nm">{t.name}</span>
                  <span className="tr">
                    <i className="fl" style={{ width: `${(v / maxWeek) * 100}%` }} />
                  </span>
                  <span className="vl">{formatDuration(v)}</span>
                </button>
              );
            })}
          </div>
          <span className="small muted">
            「5分だけ始める」から始めたものは実際にやった時間（ここまでにした分も含む）、始めずに済をつけたものは予定の長さで数えます。置いただけの予定は数えません。
          </span>
        </section>
      )}

      {(tracks.length > 0 || counts.quick[7] > 0) && (
        <section className="viz-card" aria-label="今週始めた回数">
          <span className="label">今週始めた回数</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {ranked.map((t) => (
              <span key={t.id} className="week-chip">
                <b>{t.name}</b> <span className="mono">{startsThisWeek(t.id)}回</span>
              </span>
            ))}
            <span className="week-chip">
              <b>その場の5分</b> <span className="mono">{counts.quick[7]}回</span>
            </span>
          </div>
          <span className="small muted">「5分だけ始める」を押した回数です。5分でやめた日も1回です。</span>
        </section>
      )}

      {tracks.map((t) => {
        const weeks = hist.byTrack[t.id] ?? Array(8).fill(0);
        const mx = Math.max(60, ...weeks);
        const total = weeks.reduce((a, b) => a + b, 0);
        const steps = data.steps.filter((s) => s.trackId === t.id);
        const done = steps.filter((s) => s.status === 'done').length;
        const idle = daysSinceTouched(t, lastDone[t.id], today);
        const next = steps.filter((s) => s.status === 'todo').sort((a, b) => a.order - b.order)[0];
        return (
          <section key={t.id} className="viz-card" aria-label={t.name}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{t.name}</span>
              <span className="small muted">{t.type === 'project' ? 'プロジェクト' : '習慣'}</span>
            </div>
            {t.goal && <span className="small muted">なりたい状態：{t.goal}</span>}
            {(next || idle >= 7) && (
              <span className="small muted">
                {next ? `次：${next.title}` : ''}
                {next && idle >= 7 ? '・' : ''}
                {idle >= 7 ? `最後に触ってから ${idle}日` : ''}
              </span>
            )}
            {t.type === 'project' && steps.length > 0 && (
              <>
                <div className="row small" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">ステップ</span>
                  <span className="mono">
                    {done} / {steps.length} 完了
                  </span>
                </div>
                <div className="meter" role="img" aria-label={`${steps.length}ステップ中${done}完了`}>
                  <i style={{ width: `${(done / steps.length) * 100}%` }} />
                </div>
              </>
            )}
            <div className="row small" style={{ justifyContent: 'space-between', marginTop: 4 }}>
              <span className="muted">週ごとのやった時間（直近8週）</span>
              <span className="mono muted">合計 {formatDuration(total)}</span>
            </div>
            <div className="cols" role="img" aria-label={`${t.name}の直近8週のやった時間`}>
              {weeks.map((v, i) => {
                const h = (v / mx) * 100;
                const label = `${t.name}・${i === 7 ? '今週' : `${labels[i]} の週`}`;
                return (
                  <button
                    key={hist.weeks[i]}
                    className={`c${i === 7 ? ' cur' : ''}`}
                    data-tip
                    aria-label={`${label} ${formatDuration(v)}`}
                    onPointerDown={(e) => show(e, formatDuration(v), label)}
                    onFocus={(e) => show(e, formatDuration(v), label)}
                  >
                    <i style={{ height: `${h}%` }} />
                    {i === 7 && <b style={{ bottom: `calc(${h}% + 2px)` }}>{formatDuration(v)}</b>}
                  </button>
                );
              })}
            </div>
            <div className="cols-x" aria-hidden="true">
              {labels.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
            {t.type === 'habit' && <ChangeNotes track={t} notes={data.changes.filter((c) => c.trackId === t.id)} today={today} />}
          </section>
        );
      })}

      {numberTracks.map((t) => (
        <NumberCard key={t.id} track={t} measures={data.measures.filter((m) => m.trackId === t.id)} today={today} />
      ))}

      <Timeline today={today} tracks={allTracks} journals={data.journals} plans={data.plans} changes={data.changes} measures={data.measures} />

      {tip && (
        <div className="viz-tip" role="status" style={{ left: Math.max(8, Math.min(window.innerWidth - 200, tip.x - 80)), top: Math.max(8, tip.y - 40) }}>
          <b>{tip.value}</b> {tip.label}
        </div>
      )}
    </div>
  );
}

const WD = ['月', '火', '水', '木', '金', '土', '日'];
const SQ_LABEL: Record<Square, string> = { full: '済', half: '始めた', plan: '手つかず', none: 'なし' };

/** 振り返りの7マス（2026-11-09）：取り組み × 曜日。埋まったマスを眺めるだけ（空いたマスへの言葉は出さない） */
function WeekSquares({ today, tracks, plans, starts, measures }: { today: string; tracks: Track[]; plans: Plan[]; starts: StartSession[]; measures: Measure[] }) {
  const [offset, setOffset] = useState(0);
  const dates = weekDates(today, offset);
  const sq = weekSquares(plans, starts, dates);
  const feel = weekFeel(plans, dates);
  const nights = plannedNights(plans, dates);
  const label = offset === 0 ? '今週' : offset === -1 ? '先週' : `${-offset}週まえ`;
  // マスをタップすると、下の「ふりかえり」のその日へ
  const jump = (d: string) => document.getElementById(`day-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const squareOf = (t: Track, i: number): Square =>
    t.type === 'number' ? (measures.some((m) => m.trackId === t.id && m.lifeDate === dates[i]) ? 'full' : 'none') : (sq[t.id]?.[i] ?? 'none');
  return (
    <section className="viz-card" aria-label="週の7マス">
      <div className="weekbar">
        <button className="btn-icon" aria-label="前の週" disabled={offset <= -8} onClick={() => setOffset(offset - 1)}>
          ‹
        </button>
        <div className="stack" style={{ gap: 0, alignItems: 'center' }}>
          <span className="small muted">{label}</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {shortDate(dates[0])}〜{shortDate(dates[6])}
          </span>
        </div>
        <button className="btn-icon" aria-label="次の週" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
          ›
        </button>
      </div>
      <div className="grid7">
        <span />
        {WD.map((w) => (
          <span key={w} className="hd">
            {w}
          </span>
        ))}
        {tracks.map((t) => (
          <Fragment key={t.id}>
            <span className="nm">{t.name}</span>
            {dates.map((d, i) => {
              const s = squareOf(t, i);
              const f = s === 'full' ? feel[t.id]?.[i] : undefined;
              return (
                <button
                  key={d}
                  className={`cell ${s}${f ? ` f${f}` : ''}`}
                  aria-label={`${t.name} ${WD[i]}曜 ${t.type === 'number' ? (s === 'full' ? '測った' : 'なし') : SQ_LABEL[s]}${f ? `・${FEEL_LABEL[f]}` : ''}`}
                  onClick={() => jump(d)}
                />
              );
            })}
          </Fragment>
        ))}
        <span className="nm muted" style={{ fontWeight: 500 }}>
          前の晩に組んだ
        </span>
        {nights.map((on, i) => (
          <span key={dates[i]} className="night" role="img" aria-label={`${WD[i]}曜 ${on ? '前の晩に組んだ' : 'なし'}`}>
            {on ? <i /> : null}
          </span>
        ))}
      </div>
      <div className="legend">
        <span>
          <i className="cell full" />済（習慣は手応えが強いほど濃い）
        </span>
        <span>
          <i className="cell half" />始めた（ここまで）
        </span>
        <span>
          <i className="cell plan" />置いたけど手つかず
        </span>
        <span>
          <i className="cell none" />なし
        </span>
      </div>
      <span className="small muted">その場の5分　{quickCount(starts, dates)}回</span>
    </section>
  );
}

/** 変化メモ（習慣型の感覚的な進歩）：気づいたときに1行。新しい順に積み上がる */
function ChangeNotes({ track, notes, today }: { track: Track; notes: ChangeNote[]; today: string }) {
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  const sorted = notes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shown = all ? sorted : sorted.slice(0, 3);
  const add = async () => {
    if (!text.trim()) return;
    await addChange(track.id, text, today);
    setText('');
  };
  return (
    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
      <span className="small muted">変化メモ（鏡・服の感触・人に言われたことなど）</span>
      {shown.map((c) => (
        <div key={c.id} className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
          <span className="small" style={{ overflowWrap: 'anywhere' }}>
            <span className="mono muted">{shortDate(c.lifeDate)}</span> {c.text}
          </span>
          <button className="btn-ghost" style={{ minHeight: 32 }} aria-label={`「${c.text}」を消す`} onClick={() => window.confirm('この変化メモを消しますか？') && void deleteChange(c.id)}>
            ✕
          </button>
        </div>
      ))}
      {sorted.length > 3 && (
        <button className="btn-ghost" style={{ minHeight: 32 }} onClick={() => setAll(!all)}>
          {all ? '少なく表示' : `ほかの${sorted.length - 3}件も見る`}
        </button>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          value={text}
          aria-label={`${track.name}の変化メモ`}
          placeholder="例：ベルトの穴が1つ縮んだ"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void add()}
        />
        <button className="btn" style={{ flex: 'none', whiteSpace: 'nowrap' }} disabled={!text.trim()} onClick={() => void add()}>
          残す
        </button>
      </div>
    </div>
  );
}

/** 数値型：直近12週の線グラフ。目標の線は任意（届かなくても色や言葉は変えない） */
function NumberCard({ track, measures, today }: { track: Track; measures: Measure[]; today: string }) {
  const from = addDays(today, -83);
  const series = measureSeries(measures, track.id, from, today);
  const last = series[series.length - 1];
  const W = 320;
  const H = 140;
  const pad = { l: 36, r: 8, t: 10, b: 20 };
  const vals = series.map((p) => p.value).concat(track.target !== undefined ? [track.target] : []);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || 1;
  const yMin = lo - span * 0.15;
  const yMax = hi + span * 0.15;
  const days = (d: string) => (Date.parse(d) - Date.parse(from)) / 86400000;
  const x = (d: string) => pad.l + (days(d) / 83) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <section className="viz-card" aria-label={track.name}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{track.name}</span>
        <span className="small muted">数値</span>
      </div>
      {last ? (
        <span>
          <b className="mono" style={{ fontSize: 22 }}>
            {fmt(last.value)}
          </b>{' '}
          <span className="small muted">
            {track.unit ?? ''}（{shortDate(last.date)}）
          </span>
        </span>
      ) : (
        <span className="small muted">しおりタブの「＋ 測る」から数字を入れると、ここに線グラフが出ます。</span>
      )}
      {series.length > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${track.name}の直近12週`} style={{ maxWidth: '100%' }}>
          {[yMin + (yMax - yMin) * 0.1, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.1].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
                {fmt(v)}
              </text>
            </g>
          ))}
          {track.target !== undefined && (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={y(track.target)} y2={y(track.target)} stroke="var(--muted)" strokeDasharray="4 3" strokeWidth="1" />
              <text x={W - pad.r} y={y(track.target) - 3} textAnchor="end" fontSize="10" fill="var(--muted)">
                目標 {fmt(track.target)}
              </text>
            </g>
          )}
          <path d={path} fill="none" stroke="var(--done)" strokeWidth="2" strokeLinejoin="round" />
          {series.map((p) => (
            <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={p === last ? 4 : 2.5} fill="var(--done)" />
          ))}
          <text x={pad.l} y={H - 4} fontSize="10" fill="var(--muted)">
            {shortDate(from)}
          </text>
          <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="10" fill="var(--muted)">
            {shortDate(today)}
          </text>
        </svg>
      )}
    </section>
  );
}

/** ふりかえり（1行ジャーナルの一覧）：新しい順・週ごと */
function Timeline({
  today,
  tracks,
  journals,
  plans,
  changes,
  measures,
}: {
  today: string;
  tracks: Track[];
  journals: Journal[];
  plans: Plan[];
  changes: ChangeNote[];
  measures: Measure[];
}) {
  const [weeks, setWeeks] = useState(4);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const list = timeline({ journals, plans, changes, measures }, today, weeks);
  return (
    <section className="viz-card" aria-label="ふりかえり">
      <span className="label">ふりかえり</span>
      {list.every((w) => w.days.length === 0) && <span className="small muted">1行ジャーナルや済をつけた日が、ここに新しい順に並びます。</span>}
      {list.map((w) =>
        w.days.length ? (
          <div key={w.monday} className="stack" style={{ gap: 6 }}>
            <span className="small muted">
              {shortDate(w.monday)}〜{shortDate(addDays(w.monday, 6))} の週
            </span>
            {w.days.map((d) => (
              <div key={d.date} id={`day-${d.date}`} className="tl-day">
                <span className="tl-date mono">{shortDate(d.date)}</span>
                <div className="stack" style={{ gap: 3, minWidth: 0 }}>
                  {d.journal && <span style={{ overflowWrap: 'anywhere' }}>{d.journal}</span>}
                  {d.done.length > 0 && (
                    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {d.done.map((x, i) => (
                        <span key={i} className={`tl-chip${byId.get(x.trackId)?.type === 'habit' ? ' h' : ''}`}>
                          済 {x.title}
                          {x.feel ? `・${FEEL_LABEL[x.feel]}` : ''}
                        </span>
                      ))}
                    </span>
                  )}
                  {d.changes.map((c) => (
                    <span key={c.id} className="small">
                      変化：{byId.get(c.trackId)?.name ?? ''}　{c.text}
                    </span>
                  ))}
                  {d.measures.map((m) => (
                    <span key={m.id} className="small muted">
                      {byId.get(m.trackId)?.name ?? ''}　{m.value}
                      {byId.get(m.trackId)?.unit ?? ''}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null,
      )}
      <button className="btn-ghost" onClick={() => setWeeks(weeks + 4)}>
        もっと前を見る
      </button>
    </section>
  );
}
