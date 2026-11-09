import { useEffect } from 'react';

// 横スライドで「今日 ⇄ 明日 ⇄ 週」を切り替える（2026-11-09）。
// 縦のスクロールはそのまま。横にはっきり動かしたときだけ、指に合わせて中身を動かし、70px を超えたら切り替える。
// 横にスクロールする所（候補の列など）と、選んだ予定のドラッグ中は効かない

const IGNORE = '.row-scroll, .tray, .chips, .cal-handle, .blk.sel, input, select, textarea, .sheet';

export function useSwipe(el: HTMLElement | null, opts: { enabled: boolean; canLeft: boolean; canRight: boolean; onSwipe: (dir: 'left' | 'right') => void }) {
  const { enabled, canLeft, canRight, onSwipe } = opts;
  useEffect(() => {
    if (!el || !enabled) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let tracking = false;
    let horiz: boolean | null = null;
    const reset = () => {
      el.style.transition = 'transform .18s ease-out';
      el.style.transform = '';
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || (e.target as HTMLElement).closest(IGNORE)) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0;
      horiz = null;
      tracking = true;
      el.style.transition = 'none';
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      const ddx = e.touches[0].clientX - x0;
      const ddy = e.touches[0].clientY - y0;
      if (horiz === null && (Math.abs(ddx) > 10 || Math.abs(ddy) > 10)) horiz = Math.abs(ddx) > Math.abs(ddy) * 1.3;
      if (!horiz) return;
      e.preventDefault();
      dx = ddx;
      const blocked = (dx < 0 && !canLeft) || (dx > 0 && !canRight);
      el.style.transform = `translateX(${blocked ? dx / 4 : dx}px)`;
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (horiz && Math.abs(dx) > 70) {
        const dir = dx < 0 ? 'left' : 'right';
        if ((dir === 'left' && canLeft) || (dir === 'right' && canRight)) {
          el.style.transition = 'transform .16s ease-in';
          el.style.transform = `translateX(${dir === 'left' ? -40 : 40}px)`;
          window.setTimeout(() => {
            el.style.transition = 'none';
            el.style.transform = '';
            onSwipe(dir);
          }, 140);
          return;
        }
      }
      reset();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [el, enabled, canLeft, canRight, onSwipe]);
}
