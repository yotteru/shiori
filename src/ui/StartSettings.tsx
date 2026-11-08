import { useState } from 'react';
import { useLive } from '../hooks';
import { getMeta, updateMeta } from '../lib/db';
import { SHORTCUT_START, shortcutUrl } from '../lib/shortcut';
import { DEFAULT_STOP_REASONS } from '../lib/starts';

// 始め方の設定（2026-11-08）：集中モードのショートカットと、「ここまで」の理由の候補。どちらも端末ごと
export function StartSettings() {
  const meta = useLive(() => getMeta(), []);
  const [add, setAdd] = useState('');
  if (!meta) return null;
  const reasons = meta.stopReasons ?? DEFAULT_STOP_REASONS;
  const save = (next: string[]) => updateMeta({ stopReasons: next });

  return (
    <div className="card">
      <span className="label">始め方</span>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={!!meta.focusShortcut} onChange={(e) => updateMeta({ focusShortcut: e.target.checked })} />
        <span>「5分だけ始める」で集中モードをオンにする</span>
      </label>
      <span className="small muted">
        ショートカット「{SHORTCUT_START}」を呼びます（この端末だけの設定）。作り方は
        <a href="https://github.com/yotteru/shiori/blob/main/docs/SHORTCUTS.md" target="_blank" rel="noreferrer">
          手順書
        </a>
        。集中モードは Apple Watch やコントロールセンターからオフにします。
      </span>
      <a className="btn" href={shortcutUrl(SHORTCUT_START, 'テスト')}>
        ショートカットを試す
      </a>

      <span className="label" style={{ marginTop: 8 }}>
        「ここまで」の理由の候補
      </span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {reasons.map((r) => (
          <button key={r} className="chip-btn" aria-label={`${r} を消す`} onClick={() => save(reasons.filter((x) => x !== r))}>
            {r} ✕
          </button>
        ))}
      </div>
      <div className="row">
        <input className="input" value={add} placeholder="候補を足す" onChange={(e) => setAdd(e.target.value)} />
        <button
          className="btn"
          style={{ flex: 'none', whiteSpace: 'nowrap' }}
          disabled={!add.trim() || reasons.includes(add.trim())}
          onClick={async () => {
            await save([...reasons, add.trim()]);
            setAdd('');
          }}
        >
          足す
        </button>
      </div>
      {meta.stopReasons && (
        <button className="btn-ghost" onClick={() => updateMeta({ stopReasons: undefined })}>
          最初の候補に戻す
        </button>
      )}
    </div>
  );
}
