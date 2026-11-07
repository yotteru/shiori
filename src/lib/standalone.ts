/** ホーム画面から開いているか（指示書 §3.1） */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}
