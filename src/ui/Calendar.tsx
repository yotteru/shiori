import { useEffect, useRef } from 'react';
import { fixedDepths, formatDuration, formatMinute, layoutColumns, MIN_LEN, snap, type Gap } from '../lib/calendar';

// 縦のカレンダー（2026-11-08。試作ページと同じ操作）
// - 予定をタップで選ぶ → 本体をドラッグで移動、上下の丸で開始・終了（30分から15分刻み）
// - 選んでいない予定やほかの場所に触れたときは、ふつうにページがスクロールする
// - ドラッグ中は画面の上下の端に近づくと自動でスクロールする

/** 15分 = 21px、30分 = 42px（「時刻・長さ」1行＋名前2行が入る高さ） */
export const PX_PER_MIN = 21 / 15;
const FIXED_W = 64;
const STACK_X = 10;


export interface CalBlock {
  id: string;
  title: string;
  start: number;
  min: number;
  tone: 'habit' | 'project' | 'fixed';
  status?: 'planned' | 'done' | 'undone';
  isNext?: boolean;
  /** 同じ行き先を何回か置いた日の「何回目/全部で」（2026-11-10） */
  nth?: string;
  first?: string;
  cue?: string;
}

export function Calendar({
  view,
  blocks,
  gaps,
  selectedId,
  holding,
  gapStart,
  now,
  onSelect,
  onPlace,
  onGap,
  onCommit,
  onFixedTap,
  removed = [],
  onRestoreFixed,
  marks = [],
  topInset,
  bottomInset,
}: {
  view: { start: number; end: number };
  blocks: CalBlock[];
  gaps: Gap[];
  selectedId: string | null;
  holding: boolean;
  gapStart: number | null;
  now?: number;
  onSelect: (id: string | null) => void;
  onPlace: (minute: number) => void;
  onGap: (gap: Gap | null) => void;
  onCommit: (id: string, start: number, min: number) => void;
  /** 左の固定の列の空いた所をタップ（その時刻で「この日だけの予定」を足す。2026-11-09） */
  onFixedTap?: (minute: number) => void;
  /** その日だけ外した、いつもの固定。点線で残し、タップで戻す（2026-11-09） */
  removed?: { routineId: string; title: string; start: number; min: number }[];
  onRestoreFixed?: (routineId: string, title: string) => void;
  /** その場の5分で始めた印（予定の札にはしない。2026-11-09） */
  marks?: { id: string; minute: number; title: string; live: boolean }[];
  topInset: () => number;
  bottomInset: () => number;
}) {
  const st = view.start * 60;
  const en = view.end * 60;
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { id: string; el: HTMLElement; mode: 'move' | 'top' | 'bottom'; offset: number; end: number; y: number; moved: boolean; start: number; min: number }>(null);
  const justDragged = useRef(false);
  const raf = useRef(0);

  const main = blocks.filter((b) => b.tone !== 'fixed');
  const cols = layoutColumns(main);
  const fixedOnly = blocks.filter((b) => b.tone === 'fixed');
  const depth = fixedDepths(fixedOnly);
  // すぐ後（30分以内）に別の固定が重なる固定は、名前を時刻より先に出す（上に重なっても名前が見えるように）
  const covered = new Set(fixedOnly.filter((b) => fixedOnly.some((o) => o.id !== b.id && o.start > b.start && o.start < b.start + 30)).map((b) => b.id));

  const minuteAt = (clientY: number) => {
    const r = gridRef.current!.getBoundingClientRect();
    return st + (clientY - r.top) / PX_PER_MIN;
  };

  // ---- ドラッグ ----
  const apply = () => {
    const d = drag.current;
    if (!d) return;
    const at = minuteAt(d.y);
    if (d.mode === 'move') d.start = Math.max(st, Math.min(en - d.min, snap(at - d.offset)));
    else if (d.mode === 'top') {
      const s = Math.max(st, Math.min(d.end - MIN_LEN, snap(at)));
      d.start = s;
      d.min = d.end - s;
    } else d.min = Math.max(d.start + MIN_LEN, Math.min(en, snap(at))) - d.start;
    d.el.style.top = `${(d.start - st) * PX_PER_MIN}px`;
    d.el.style.height = `${d.min * PX_PER_MIN - 2}px`;
    let bub = d.el.querySelector<HTMLElement>('.cal-bubble');
    if (!bub) {
      bub = document.createElement('span');
      bub.className = 'cal-bubble';
      d.el.appendChild(bub);
    }
    bub.textContent = `${formatMinute(d.start)}–${formatMinute(d.start + d.min)}`;
  };
  const autoScroll = () => {
    raf.current = 0;
    const d = drag.current;
    if (!d) return;
    const top = topInset() + 30;
    const bottom = window.innerHeight - bottomInset() - 30;
    const dy = d.y < top ? -10 : d.y > bottom ? 10 : 0;
    if (dy) {
      window.scrollBy(0, dy);
      apply();
      raf.current = requestAnimationFrame(autoScroll);
    }
  };

  const startDrag = (e: React.PointerEvent, b: CalBlock, mode: 'move' | 'top' | 'bottom') => {
    const el = gridRef.current!.querySelector<HTMLElement>(`[data-blk="${CSS.escape(b.id)}"]`);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { id: b.id, el, mode, offset: minuteAt(e.clientY) - b.start, end: b.start + b.min, y: e.clientY, moved: false, start: b.start, min: b.min };
    gridRef.current!.classList.add('dragging');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.y = e.clientY;
    d.moved = true;
    apply();
    if (!raf.current) raf.current = requestAnimationFrame(autoScroll);
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    gridRef.current?.classList.remove('dragging');
    d.el.querySelector('.cal-bubble')?.remove();
    if (d.moved) {
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 60);
      onCommit(d.id, d.start, d.min);
    }
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---- タップ ----
  const tapGrid = (e: React.MouseEvent) => {
    if (justDragged.current) return;
    if (holding) onPlace(minuteAt(e.clientY) - 7);
    else if (onFixedTap && !selectedId && e.clientX - gridRef.current!.getBoundingClientRect().left < FIXED_W) {
      // タップした所を含む15分の始まりにそろえ、表示の時間帯に収める
      const m = Math.floor(minuteAt(e.clientY) / 15) * 15;
      onFixedTap(Math.max(st, Math.min(en - 30, m)));
    } else {
      onSelect(null);
      onGap(null);
    }
  };

  const hours: number[] = [];
  for (let t = st; t <= en; t += 60) hours.push(t);
  const lines: number[] = [];
  for (let t = st + 30; t < en; t += 30) lines.push(t);
  const sel = blocks.find((b) => b.id === selectedId);
  const pos = (b: CalBlock) => {
    if (b.tone === 'fixed') {
      // 重なった固定は、後から始まるものを右にずらして上に重ねる（両方の名前の頭が見える。2026-11-10）
      const d = depth[b.id] ?? 0;
      // 幅はほとんど縮めず、少しだけ取り組みの列にはみ出してよい（細くすると名前が読めない）
      return { left: `${3 + d * STACK_X}px`, width: `${FIXED_W - 6 - d * 4}px`, zIndex: d ? 1 + d : undefined };
    }
    const c = cols[b.id] ?? { col: 0, cols: 1 };
    return {
      left: `calc(${FIXED_W + 6}px + (100% - ${FIXED_W + 10}px) * ${c.col} / ${c.cols})`,
      width: `calc((100% - ${FIXED_W + 10}px) / ${c.cols} - 2px)`,
    };
  };

  return (
    <div className="cal">
      <div className="cal-axis">
        {hours.map((t) => (
          <span key={t} style={{ top: (t - st) * PX_PER_MIN }}>
            {Math.floor(t / 60) >= 24 ? `翌${Math.floor(t / 60) - 24}` : Math.floor(t / 60)}:00
          </span>
        ))}
      </div>
      <div
        ref={gridRef}
        className={`cal-grid${holding ? ' holding' : ''}`}
        style={{ height: (en - st) * PX_PER_MIN }}
        onClick={tapGrid}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="cal-lane" />
        {lines.map((t) => (
          <span key={t} className={`cal-hline${t % 60 ? ' half' : ''}`} style={{ top: (t - st) * PX_PER_MIN }} />
        ))}
        {gaps.map((g) => (
          <button
            key={g.start}
            className={`cal-gap${gapStart === g.start ? ' on' : ''}`}
            style={{ top: (g.start - st) * PX_PER_MIN + 2, height: g.len * PX_PER_MIN - 4 }}
            onClick={(e) => {
              e.stopPropagation();
              // 候補を持っているときは、空きの札の上でもタップした時刻に置く
              if (holding) onPlace(minuteAt(e.clientY) - 7);
              else onGap(gapStart === g.start ? null : g);
            }}
          >
            空き {g.len >= 60 ? `${Math.floor(g.len / 60)}時間` : ''}
            {g.len % 60 ? `${g.len % 60}分` : ''}
          </button>
        ))}
        {removed.map((r) => (
          <button
            key={r.routineId}
            className="blk fixed-off"
            aria-label={`${r.title}（この日は外している）を戻す`}
            style={{ left: '3px', width: `${FIXED_W - 6}px`, top: (r.start - st) * PX_PER_MIN, height: Math.max(30, Math.min(r.min, en - r.start)) * PX_PER_MIN - 2 }}
            onClick={(e) => {
              e.stopPropagation();
              if (holding) onPlace(minuteAt(e.clientY) - 7);
              else onRestoreFixed?.(r.routineId, r.title);
            }}
          >
            <span className="tt">{r.title}</span>
            <span className="tm">戻す</span>
          </button>
        ))}
        {blocks.map((b) => {
          const isSel = b.id === selectedId;
          // かかる時間は「1時間30分」の形で（2026-11-10）。固定は列が細いので、時刻と別の行に出す
          const time = b.tone === 'fixed' ? `${formatMinute(b.start)}〜` : `${formatMinute(b.start)}–${formatMinute(b.start + b.min)}・${formatDuration(b.min)}`;
          const cls = [
            'blk',
            b.isNext ? 'next' : b.tone,
            b.tone !== 'fixed' && b.min >= 60 ? 'tall' : '',
            b.status === 'done' ? 'done' : b.status === 'undone' ? 'undone' : '',
            depth[b.id] ? 'stacked' : '',
            covered.has(b.id) ? 'covered' : '',
            isSel ? 'sel' : '',
          ].join(' ');
          return (
            <div
              key={b.id}
              data-blk={b.id}
              className={cls}
              style={{ ...pos(b), top: (b.start - st) * PX_PER_MIN, height: b.min * PX_PER_MIN - 2 }}
              onClick={(e) => {
                e.stopPropagation();
                if (justDragged.current) return;
                if (holding) onPlace(minuteAt(e.clientY) - 7);
                else onSelect(b.id);
              }}
              onPointerDown={isSel ? (e) => startDrag(e, b, 'move') : undefined}
            >
              <span className="tm">
                {time}
                {b.nth && <i className="nth">{b.nth}</i>}
              </span>
              <span className="tt" ref={fitTitle}>
                {b.title}
              </span>
              {b.tone === 'fixed' && (
                <span className="du">
                  {/* 折り返すなら「1時間 / 30分」の切れ目で */}
                  {formatDuration(b.min).replace(/(時間)(?=\d)/, '$1\u200b')}
                </span>
              )}
              {b.isNext && (b.first || b.cue) && b.min >= 60 && (
                <span className="first">{b.cue ? `${b.cue} → ${b.first || '始める'}` : `最初の一手：${b.first}`}</span>
              )}
              {b.status === 'done' && <span className="stamp-s">済</span>}
            </div>
          );
        })}
        {sel &&
          (['top', 'bottom'] as const).map((mode) => {
            const p = pos(sel);
            const y = mode === 'top' ? (sel.start - st) * PX_PER_MIN : (sel.start + sel.min - st) * PX_PER_MIN - 2;
            // 固定は列が細く、丸が本体を覆って予定ごと動かせなかった。固定では丸を予定の外（上・下）に出す（2026-11-10）
            const outside = sel.tone === 'fixed';
            const top = outside ? (mode === 'top' ? y - 38 : y - 6) : y - 22;
            return (
              <span
                key={mode}
                className={`cal-handle${outside ? (mode === 'top' ? ' out-top' : ' out-bottom') : ''}`}
                aria-label={mode === 'top' ? '開始時刻を変える' : '終了時刻を変える'}
                style={{
                  top,
                  left: outside ? `calc(${p.left} + ${p.width} / 2 - 22px)` : mode === 'top' ? `calc(${p.left} + ${p.width} - 54px)` : `calc(${p.left} + 10px)`,
                }}
                onPointerDown={(e) => startDrag(e, sel, mode)}
                onClick={(e) => e.stopPropagation()}
              >
                <i />
              </span>
            );
          })}
        {marks
          .filter((m) => m.minute >= st && m.minute <= en)
          .map((m) => (
            <span key={m.id} className={`cal-mark${m.live ? ' live' : ''}`} style={{ top: (m.minute - st) * PX_PER_MIN }}>
              <i>▶</i>
              {m.title}
            </span>
          ))}
        {now !== undefined && now > st && now < en && (
          <div className="cal-now" style={{ top: (now - st) * PX_PER_MIN }}>
            <i />
            <b />
            <span>いま {formatMinute(now)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** 名前が2行に収まらないときだけ、0.5px ずつ小さくする（10px まで） */
function fitTitle(el: HTMLSpanElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    const blk = el.parentElement;
    if (!blk) return;
    el.style.fontSize = '';
    let fs = 11;
    const over = () => blk.scrollHeight > blk.clientHeight + 1 || el.scrollHeight > el.clientHeight + 1;
    while (over() && fs > 10) {
      fs -= 0.5;
      el.style.fontSize = `${fs}px`;
    }
  });
}
