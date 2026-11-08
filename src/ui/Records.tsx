import { useEffect, useState } from 'react';
import { useLive, useNow } from '../hooks';
import { formatDuration } from '../lib/calendar';
import { lastDoneByTrack } from '../lib/candidates';
import { db } from '../lib/db';
import { addDays, lifeDate } from '../lib/lifeDate';
import { weeklyHistory, weeklyStarts } from '../lib/records';
import { daysSinceTouched } from '../lib/tracks';

// 記録タブ（2026-11-08）：眺める・振り返る場所。やった時間（始めた記録があれば実際の時間）と、始めた回数

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function Records() {
  const now = useNow();
  const today = lifeDate(now);
  const data = useLive(
    async () => ({ plans: await db.plans.toArray(), tracks: await db.tracks.toArray(), steps: await db.steps.toArray(), starts: await db.starts.toArray() }),
    [],
  );
  const [tip, setTip] = useState<{ x: number; y: number; value: string; label: string } | null>(null);
  useEffect(() => {
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, { passive: true });
    return () => window.removeEventListener('scroll', hide);
  }, []);
  if (!data) return null;

  const tracks = data.tracks.filter((t) => !t.archivedAt);
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
      {tracks.length === 0 && <p className="sub">取り組みを作って済をつけると、ここに時間が積み上がります。</p>}

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
          </section>
        );
      })}

      {tip && (
        <div className="viz-tip" role="status" style={{ left: Math.max(8, Math.min(window.innerWidth - 200, tip.x - 80)), top: Math.max(8, tip.y - 40) }}>
          <b>{tip.value}</b> {tip.label}
        </div>
      )}
    </div>
  );
}
