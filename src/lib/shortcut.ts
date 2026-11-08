// iPhone のショートカットを呼ぶ（2026-11-08）。「始める」で集中モード「しおり」をオンにする。
// 何分続けるかを数字で渡す（予定の長さ。その場の5分は60分）。
// ただし、時刻で自動オフにするショートカット（日付を調整 → その時刻までオン）は iOS で「時刻が無効」になり動かなかったため、
// 今のショートカットは「オフ時までオン」の1行で、数字は使っていない（2026-11-08 見送り。終わったら Watch から切る）。
// 終わってもしおりには戻らない（戻り先を指定すると Safari が開くため）。作り方は docs/SHORTCUTS.md

export const SHORTCUT_START = 'しおり5分';

/** その場の5分で始めたときに集中モードを続ける長さ（分） */
export const QUICK_FOCUS_MINUTES = 60;

/** 集中モードを何分続けるか。計画の行き先は予定の長さ、その場の5分は60分 */
export function focusMinutes(plannedMinutes?: number): number {
  return Math.max(5, Math.round(plannedMinutes ?? QUICK_FOCUS_MINUTES));
}

/** 「しおり5分」を呼ぶ URL。入力は集中モードを続ける分数（数字だけ） */
export function focusShortcutUrl(minutes: number): string {
  return shortcutUrl(SHORTCUT_START, String(focusMinutes(minutes)));
}

export function shortcutUrl(name: string, text?: string): string {
  const q = new URLSearchParams({ name });
  if (text !== undefined) {
    q.set('input', 'text');
    q.set('text', text);
  }
  return `shortcuts://run-shortcut?${q.toString().replace(/\+/g, '%20')}`;
}
