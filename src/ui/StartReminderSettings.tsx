import { useState } from 'react';
import { useLive } from '../hooks';
import { getMeta, updateMeta } from '../lib/db';
import {
  DEFAULT_START_REMINDER,
  LEAD_CHOICES,
  NAME_TOKEN,
  reminderBody,
  startReminderSettings,
  type StartReminderSettings,
} from '../lib/startReminders';
import { supabase } from '../lib/supabase';

// 予定の開始時刻の通知と日曜の知らせの設定（2026-11-08・11-09）。端末ごと。「通知」のカードの中に入る
export function StartReminderSettingsCard() {
  const meta = useLive(() => getMeta(), []);
  const [draft, setDraft] = useState<string | null>(null);
  if (!supabase || !meta) return null;
  const s = startReminderSettings(meta);
  const save = (patch: Partial<StartReminderSettings>) => updateMeta({ startReminder: { ...s, ...patch } });
  const template = draft ?? s.template;
  const commitTemplate = () => {
    if (draft !== null) void save({ template: draft });
    setDraft(null);
  };

  return (
    <div className="stack">
      <span className="label">予定の開始時刻</span>
      <span className="sub">カレンダーに置いた今日・明日の行き先の時刻に知らせます。</span>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
        <span>開始時刻に知らせる</span>
      </label>

      {s.enabled && (
        <>
          <label className="field">
            <span>タイミング</span>
            <select className="input" value={s.leadMinutes} onChange={(e) => void save({ leadMinutes: Number(e.target.value) })}>
              {LEAD_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? '開始時刻ちょうど' : `${m}分前`}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>対象</span>
            <label className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="radio" name="sr-target" checked={s.target === 'all'} onChange={() => void save({ target: 'all' })} />
              <span>すべての行き先</span>
            </label>
            <label className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="radio" name="sr-target" checked={s.target === 'first'} onChange={() => void save({ target: 'first' })} />
              <span>その日の最初の行き先だけ</span>
            </label>
          </div>

          <label className="field">
            <span>文面</span>
            <input
              className="input"
              value={template}
              maxLength={120}
              placeholder={DEFAULT_START_REMINDER.template}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTemplate}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && commitTemplate()}
            />
          </label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {!template.includes(NAME_TOKEN) && (
              <button className="chip-btn" onClick={() => void save({ template: `${NAME_TOKEN} の時間です` }).then(() => setDraft(null))}>
                行き先の名前を入れる
              </button>
            )}
            <button className="chip-btn" onClick={() => void save({ template: DEFAULT_START_REMINDER.template }).then(() => setDraft(null))}>
              最初の文面に戻す
            </button>
          </div>
          <span className="small muted">例：「{reminderBody(template, 'アドイン：干渉判定を作る')}」</span>
          <span className="small muted">
            {template.includes(NAME_TOKEN)
              ? `「${NAME_TOKEN}」が行き先の名前になります。名前は通知を送るまでサーバーに置かれ、送ったら消えます。`
              : `「${NAME_TOKEN}」と書くと、行き先の名前が入ります（名前は送るまでサーバーに置かれます）。`}
          </span>
        </>
      )}
      <span className="label" style={{ marginTop: 8 }}>
        日曜の知らせ
      </span>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={!!meta.weekReminder} onChange={(e) => void updateMeta({ weekReminder: e.target.checked })} />
        <span>日曜の21時に「来週の見通し」を知らせる</span>
      </label>
    </div>
  );
}
