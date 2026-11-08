// iPhone のショートカットを呼ぶ（2026-11-08）。「始める」で集中モード「しおり」をオンにする。
// 終わってもしおりには戻らない（戻り先を指定すると Safari が開くため）。作り方は docs/SHORTCUTS.md

export const SHORTCUT_START = 'しおり5分';

export function shortcutUrl(name: string, text?: string): string {
  const q = new URLSearchParams({ name });
  if (text !== undefined) {
    q.set('input', 'text');
    q.set('text', text);
  }
  return `shortcuts://run-shortcut?${q.toString().replace(/\+/g, '%20')}`;
}
