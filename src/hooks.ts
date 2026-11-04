import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { now, onClockChange } from './lib/clock';

/** IndexedDB の内容を購読する。変更があれば自動で再描画する */
export function useLive<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: () => console.error('データの読み込みに失敗しました'),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** 「今」。30秒ごと・アプリに戻ったとき・日時の上書きを変えたときに更新する */
export function useNow(): Date {
  const [t, setT] = useState(() => now());
  useEffect(() => {
    const tick = () => setT(now());
    const id = window.setInterval(tick, 30_000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    const off = onClockChange(tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      off();
    };
  }, []);
  return t;
}
