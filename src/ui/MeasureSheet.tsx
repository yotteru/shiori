import { useState } from 'react';
import { useLive } from '../hooks';
import { db } from '../lib/db';
import { addMeasure, parseMeasure } from '../lib/reflection';
import type { Track } from '../lib/types';
import { Sheet } from './common';

// 「＋ 測る」（2026-11-09）：数値型の取り組みに、数字を1つ入れるだけ
export function MeasureSheet({ date, tracks, onClose, onSaved }: { date: string; tracks: Track[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const last = useLive(async () => {
    const out: Record<string, { value: number; date: string } | undefined> = {};
    for (const t of tracks) {
      const ms = await db.measures.where('trackId').equals(t.id).toArray();
      const m = ms.sort((a, b) => b.at.localeCompare(a.at))[0];
      out[t.id] = m ? { value: m.value, date: m.lifeDate } : undefined;
    }
    return out;
  }, [tracks.map((t) => t.id).join()]);

  const save = async (t: Track) => {
    const v = parseMeasure(values[t.id] ?? '');
    if (v === null) return;
    await addMeasure(t.id, v, date);
    setValues({ ...values, [t.id]: '' });
    onSaved(`${t.name}：${v}${t.unit ?? ''} を記録しました`);
  };

  return (
    <Sheet onClose={onClose} label="測る">
      <span style={{ fontSize: 18, fontWeight: 700 }}>測る</span>
      <span className="sub">数字を1つ入れるだけ。移り変わりは記録タブのグラフで見られます。</span>
      {tracks.map((t) => {
        const raw = values[t.id] ?? '';
        const ok = parseMeasure(raw) !== null;
        const l = last?.[t.id];
        return (
          <div key={t.id} className="card">
            <span className="label">{t.name}</span>
            {l && (
              <span className="small muted">
                前回：{l.value}
                {t.unit ?? ''}（{Number(l.date.slice(5, 7))}/{Number(l.date.slice(8, 10))}）
              </span>
            )}
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                inputMode="decimal"
                aria-label={`${t.name}の値`}
                value={raw}
                placeholder={l ? String(l.value) : '例：72.5'}
                onChange={(e) => setValues({ ...values, [t.id]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && ok && void save(t)}
              />
              <span className="small muted" style={{ flex: 'none' }}>
                {t.unit ?? ''}
              </span>
              <button className="btn-primary" style={{ flex: 'none', minHeight: 48, padding: '0 16px' }} disabled={!ok} onClick={() => void save(t)}>
                記録
              </button>
            </div>
          </div>
        );
      })}
      <button className="btn-ghost" onClick={onClose}>
        閉じる
      </button>
    </Sheet>
  );
}
