import { useEffect, useRef } from 'react';
import { formatMinute, layoutColumns, MIN_LEN, snap, type Gap } from '../lib/calendar';

// 縦のカレンダー（2026-11-08。試作ページと同じ操作）
// - 予定をタップで選ぶ → 本体をドラッグで移動、上下の丸で開始・終了（30分から15分刻み）
// - 選んでいない予定やほかの場所に触れたときは、ふつうにページがスクロールする
// - ドラッグ中は画面の上下の端に近づくと自動でスクロールする

/** 15分 = 21px、30分 = 42px（「時刻・長さ」1行＋名前2行が入る高さ） */
export const PX_PER_MIN = 21 / 15;
const FIXED_W = 64;

export interface CalBlock {
  id: string;
  title: string;
  start: number;
  min: number;
  tone: 'habit' | 'project' | 'fixed';
  status?: 'planned' | 'done' | 'undone';
  isNext?: boolean;
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
    else {
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
    if (b.tone === 'fixed') return { left: '3px', width: `${FIXED_W - 6}px` };
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
        {blocks.map((b) => {
          const isSel = b.id === selectedId;
          const time = b.tone === 'fixed' ? `${formatMinute(b.start)}〜` : `${formatMinute(b.start)}–${formatMinute(b.start + b.min)}・${b.min}分`;
          const cls = [
            'blk',
            b.isNext ? 'next' : b.tone,
            b.tone !== 'fixed' && b.min >= 60 ? 'tall' : '',
            b.status === 'done' ? 'done' : b.status === 'undone' ? 'undone' : '',
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
              <span className="tm">{time}</span>
              <span className="tt" ref={fitTitle}>
                {b.title}
              </span>
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
            return (
              <span
                key={mode}
                className="cal-handle"
                aria-label={mode === 'top' ? '開始時刻を変える' : '終了時刻を変える'}
                style={{ top: y - 22, left: mode === 'top' ? `calc(${p.left} + ${p.width} - 54px)` : `calc(${p.left} + 10px)` }}
                onPointerDown={(e) => startDrag(e, sel, mode)}
                onClick={(e) => e.stopPropagation()}
              >
                <i />
              </span>
            );
          })}
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
