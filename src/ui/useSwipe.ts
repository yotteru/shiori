import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

// 横スライドで「今日 ⇄ 明日 ⇄ 週」を切り替える（2026-11-09。画面のどこでも）。
// 指に合わせて中身（pane）が横に動き、離すとページをめくるように次の画面が反対側から入ってくる。
// 縦のスクロールはそのまま。横にスクロールする所（候補の列など）・選んだ予定・シート・入力欄では効かない

const IGNORE = '.row-scroll, .tray, .chips, .cal-handle, .blk.sel, input, select, textarea, .sheet, .backdrop, .tabbar';
const OUT_MS = 150;
const IN_MS = 220;

export function useSwipe(pane: HTMLElement | null, opts: { enabled: boolean; canLeft: boolean; canRight: boolean; onSwipe: (dir: 'left' | 'right') => void }) {
  // 最新の設定は ref で持ち、リスナーは貼り直さない（指の途中で外れないように）
  const cur = useRef(opts);
  cur.current = opts;

  useEffect(() => {
    if (!pane) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let tracking = false;
    let horiz: boolean | null = null;
    let raf = 0;
    let busy = false;

    const setX = (x: number, opacity = 1, transition = 'none') => {
      pane.style.transition = transition;
      pane.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
      pane.style.opacity = opacity === 1 ? '' : String(opacity);
    };

    const start = (e: TouchEvent) => {
      if (busy || !cur.current.enabled || e.touches.length !== 1) return;
      if ((e.target as HTMLElement).closest(IGNORE)) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0;
      horiz = null;
      tracking = true;
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      const ddx = e.touches[0].clientX - x0;
      const ddy = e.touches[0].clientY - y0;
      if (horiz === null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) horiz = Math.abs(ddx) > Math.abs(ddy) * 1.2;
      if (!horiz) return;
      e.preventDefault();
      dx = ddx;
      const { canLeft, canRight } = cur.current;
      const blocked = (dx < 0 && !canLeft) || (dx > 0 && !canRight);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setX(blocked ? dx / 4 : dx, blocked ? 1 : 1 - Math.min(0.35, Math.abs(dx) / 1200)));
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      cancelAnimationFrame(raf);
      const w = window.innerWidth;
      const dir = dx < 0 ? 'left' : 'right';
      const allowed = (dir === 'left' && cur.current.canLeft) || (dir === 'right' && cur.current.canRight);
      if (horiz && allowed && Math.abs(dx) > Math.min(80, w * 0.2)) {
        busy = true;
        const sign = dir === 'left' ? -1 : 1;
        setX(sign * w, 0.4, `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`);
        window.setTimeout(() => {
          // 次の画面を描いてから（見出し・下の操作エリアも同時に変わる）、反対側から入れる
          flushSync(() => cur.current.onSwipe(dir));
          setX(-sign * w * 0.5, 0.4);
          void pane.offsetWidth;
          setX(0, 1, `transform ${IN_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${IN_MS}ms ease-out`);
          window.setTimeout(() => {
            setX(0);
            busy = false;
          }, IN_MS);
        }, OUT_MS);
        return;
      }
      setX(0, 1, 'transform .18s ease-out, opacity .18s ease-out');
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
      setX(0);
    };
  }, [pane]);
}

/** ボタンで切り替えるときも、同じ向きのスライドで見せる */
export function slideTo(pane: HTMLElement | null, dir: 'left' | 'right', change: () => void) {
  if (!pane || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  const w = window.innerWidth;
  const sign = dir === 'left' ? -1 : 1;
  pane.style.transition = `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`;
  pane.style.transform = `translate3d(${sign * w * 0.5}px, 0, 0)`;
  pane.style.opacity = '0.3';
  window.setTimeout(() => {
    flushSync(change);
    pane.style.transition = 'none';
    pane.style.transform = `translate3d(${-sign * w * 0.5}px, 0, 0)`;
    void pane.offsetWidth;
    pane.style.transition = `transform ${IN_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${IN_MS}ms ease-out`;
    pane.style.transform = '';
    pane.style.opacity = '';
  }, OUT_MS);
}
