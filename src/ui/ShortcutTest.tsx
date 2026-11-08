// ショートカット連携の実機テスト（2026-11-08）。
// 「5分だけ始める」の見直しで、ホーム画面のしおりから iPhone のショートカットを呼べるかを確かめる。
// 呼べれば「集中モードをオン」「5分後の通知（リマインダー経由で Apple Watch にも届く）」をショートカットに任せる。
// 作り方は docs/SHORTCUTS.md

export const SHORTCUT_START = 'しおり5分';
const SHORTCUT_TEST = 'しおりテスト';

export function shortcutUrl(name: string, text?: string): string {
  const q = new URLSearchParams({ name });
  if (text !== undefined) {
    q.set('input', 'text');
    q.set('text', text);
  }
  return `shortcuts://run-shortcut?${q.toString().replace(/\+/g, '%20')}`;
}

/** 終わったらしおりに戻ってくるか（x-success に今のページを渡す） */
function callbackUrl(name: string): string {
  const back = typeof location === 'undefined' ? '' : location.href.split('#')[0];
  const q = new URLSearchParams({ name, 'x-success': back, 'x-cancel': back, 'x-error': back });
  return `shortcuts://x-callback-url/run-shortcut?${q.toString().replace(/\+/g, '%20')}`;
}

const tests: { label: string; note: string; href: () => string }[] = [
  { label: '1. 呼べるか', note: `「${SHORTCUT_TEST}」が動き、通知が出れば成功`, href: () => shortcutUrl(SHORTCUT_TEST) },
  { label: '2. 戻ってくるか', note: '動いたあと、しおり（ホーム画面のアプリ）に戻れば成功。Safari が開いたら失敗', href: () => callbackUrl(SHORTCUT_TEST) },
  {
    label: '3. 集中モードをオンにする',
    note: `「${SHORTCUT_START}」で集中モード「しおり」がオンになれば成功（5分の知らせは上の「5分の知らせ」で試します）`,
    href: () => shortcutUrl(SHORTCUT_START, 'テストの行き先'),
  },
];

export function ShortcutTestSettings() {
  return (
    <div className="card">
      <span className="label">テスト：ショートカットを呼ぶ</span>
      <span className="sub">
        「5分だけ始める」の見直し用です。手順書のとおりにショートカットを作ってから試してください。
      </span>
      <a className="btn" href="https://github.com/yotteru/shiori/blob/main/docs/SHORTCUTS.md" target="_blank" rel="noreferrer">
        手順書を開く
      </a>
      {tests.map((t) => (
        <div key={t.label} className="stack" style={{ gap: 2 }}>
          <a className="btn" href={t.href()}>
            {t.label}
          </a>
          <span className="small muted">{t.note}</span>
        </div>
      ))}
    </div>
  );
}
