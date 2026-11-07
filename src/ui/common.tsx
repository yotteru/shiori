import { useEffect, useRef, type ReactNode } from 'react';
import { timeOptions } from '../lib/schedule';

export const MINUTE_CHOICES = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180];

export function MinutesSelect({ value, onChange, id }: { value: number; onChange: (m: number) => void; id?: string }) {
  const choices = MINUTE_CHOICES.includes(value) ? MINUTE_CHOICES : [...MINUTE_CHOICES, value].sort((a, b) => a - b);
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {choices.map((m) => (
        <option key={m} value={m}>
          {m}分
        </option>
      ))}
    </select>
  );
}

/** 時刻の選択。iPhone のネイティブ時刻入力ははみ出すので <select> で代替する（§11） */
export function TimeSelect({ value, onChange, label, step = 15 }: { value: string; onChange: (v: string) => void; label: string; step?: number }) {
  const opts = timeOptions(step);
  const list = opts.includes(value) ? opts : [...opts, value].sort();
  return (
    <select className="select mono" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

export function Sheet({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, action, onAction, onTimeout, ms = 5000 }: {
  message: string;
  action?: string;
  onAction?: () => void;
  onTimeout: () => void;
  ms?: number;
}) {
  const cb = useRef(onTimeout);
  cb.current = onTimeout;
  useEffect(() => {
    const id = window.setTimeout(() => cb.current(), ms);
    return () => window.clearTimeout(id);
  }, [message, ms]);
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  );
}

/** 長押し（600ms）を検出するハンドラ */
export function useLongPress(onLongPress: () => void, ms = 600) {
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        onLongPress();
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
