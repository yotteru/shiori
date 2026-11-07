// アプリ内の「今」はすべてここから取る（指示書 §6）。
// new Date() を直接使ってよいのはこのファイルだけ。

let override: Date | null = null;
const listeners = new Set<() => void>();

/** 上書きの設定・解除を購読する（画面の再描画用） */
export function onClockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 現在日時。開発用の上書き（Meta.debugNow）があればそれを返す */
export function now(): Date {
  return override ? new Date(override.getTime()) : new Date();
}

/** 現在日時の ISO 文字列 */
export function nowIso(): string {
  return now().toISOString();
}

/** 上書きを設定・解除する（null で解除）。永続化は呼び出し側で Meta.debugNow に保存する */
export function setDebugNow(iso: string | null | undefined): void {
  if (!iso) {
    override = null;
  } else {
    const d = new Date(iso);
    override = Number.isNaN(d.getTime()) ? null : d;
  }
  listeners.forEach((fn) => fn());
}

export function isDebugNowActive(): boolean {
  return override !== null;
}

/** ISO 文字列や数値から Date を作る（「今」以外の日時の復元用） */
export function toDate(value: string | number): Date {
  return new Date(value);
}
