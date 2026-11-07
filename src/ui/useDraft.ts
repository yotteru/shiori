import { useEffect, useRef, useState } from 'react';
import { nowIso } from '../lib/clock';
import { db } from '../lib/db';

/**
 * 入力途中の自動保存（§3.7）。入力のたびに 500ms のデバウンスで Draft に保存し、
 * 開き直したら復元する。確定したら clear() で消す
 */
export function useDraft(key: string, initial = ''): [string, (v: string) => void, () => Promise<void>, boolean] {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(value);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    db.drafts.get(key).then((d) => {
      if (!alive) return;
      if (d) {
        setValue(d.value);
        latest.current = d.value;
      } else {
        setValue(initial);
        latest.current = initial;
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
    // initial は最初の値だけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 画面を離れる直前の入力も保存する
  useEffect(() => {
    const flush = () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
        void db.drafts.put({ key, value: latest.current, updatedAt: nowIso() });
      }
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key]);

  const set = (v: string) => {
    setValue(v);
    latest.current = v;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void db.drafts.put({ key, value: v, updatedAt: nowIso() });
    }, 500);
  };

  const clear = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    await db.drafts.delete(key);
  };

  return [value, set, clear, loaded];
}
