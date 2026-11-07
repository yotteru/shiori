// 時刻の割り付けと時間の残量（指示書 §3.4、受け入れテスト 4）

export const GAP_MINUTES = 10;
const DAY = 24 * 60;

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/** 分 → 'HH:mm'（24時を超えたら折り返す） */
export function formatHm(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 時間帯の長さ（分）。終わりが始まり以前なら日をまたぐものとして扱う */
export function windowLength(window: { start: string; end: string }): number {
  const s = parseHm(window.start);
  let e = parseHm(window.end);
  if (e <= s) e += DAY;
  return e - s;
}

/** 開始時刻から、所要時間＋10分ずつ順に割り付けた開始時刻の一覧 */
export function assignTimes(start: string, minutes: number[], gap = GAP_MINUTES): string[] {
  let t = parseHm(start);
  return minutes.map((m) => {
    const at = formatHm(t);
    t += m + gap;
    return at;
  });
}

export interface Capacity {
  /** 行き先の所要時間の合計（分） */
  used: number;
  /** 時間帯の長さ（分） */
  total: number;
  remaining: number;
  /** 時間が足りない（警告状態） */
  over: boolean;
}

/** 時間の残量。画面案2-A と同じく、所要時間の合計を時間帯の長さと比べる */
export function capacity(window: { start: string; end: string }, minutes: number[]): Capacity {
  const used = minutes.reduce((a, b) => a + b, 0);
  const total = windowLength(window);
  return { used, total, remaining: total - used, over: used > total };
}

/** 時間帯の選択肢（15分刻み）。iPhone で入力欄がはみ出さないよう <select> で使う */
export function timeOptions(stepMinutes = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < DAY; m += stepMinutes) out.push(formatHm(m));
  return out;
}
