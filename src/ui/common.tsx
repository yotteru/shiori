import { useEffect, useRef, type ReactNode } from 'react';
import { timeOptions } from '../lib/schedule';

// 予定の最小単位は30分（2026-11-08）。それ以降は15分刻み
export const MINUTE_CHOICES = [30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];

export function MinutesSelect({ value, onChange, id }: { value: number; onChange: (m: number) => void; id?: string }) {
  // 30分未満の古い値は30分として表示する（カレンダーでも30分で置かれる）
  const shown = value < 30 ? 30 : value;
  const choices = MINUTE_CHOICES.includes(shown) ? MINUTE_CHOICES : [...MINUTE_CHOICES, shown].sort((a, b) => a - b);
  return (
    <select id={id} className="select" value={shown} onChange={(e) => onChange(Number(e.target.value))}>
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

/** 終わりの時刻（その日の 0:00 からの分）。翌日にまたがるときは「翌」を付ける */
export function formatEnd(m: number): string {
  const hh = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return m >= 24 * 60 ? `翌${hh - 24}:${mm}` : `${String(hh).padStart(2, '0')}:${mm}`;
}

/**
 * 終わりの時刻を選ぶ（2026-11-09）。開始の30分後から16時間後まで15分刻み。
 * 仕事（9時間）や睡眠（翌朝まで）のような長い予定も置ける
 */
export function EndSelect({ start, value, onChange }: { start: number; value: number; onChange: (end: number) => void }) {
  const opts: number[] = [];
  for (let m = start + 30; m <= start + 16 * 60; m += 15) opts.push(m);
  const shown = opts.includes(value) ? value : opts.find((m) => m >= value) ?? opts[opts.length - 1];
  return (
    <select className="select mono" aria-label="終わり" value={shown} onChange={(e) => onChange(Number(e.target.value))}>
      {opts.map((m) => (
        <option key={m} value={m}>
          {formatEnd(m)}
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
