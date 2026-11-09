// 生活日（指示書 §2.1）。1日の区切りは JST 朝4:00。
// SQL 側の public.life_date(timestamptz) と同じ定義：
//   (ts at time zone 'Asia/Tokyo' - interval '4 hours')::date

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_START_HOUR = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC の Date を「JST の壁時計」を UTC フィールドに載せた Date に変換する */
function toJstWall(d: Date): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(wall: Date): string {
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
}

/** 生活日 'YYYY-MM-DD' */
export function lifeDate(at: Date): string {
  return ymd(new Date(toJstWall(at).getTime() - DAY_START_HOUR * 60 * 60 * 1000));
}

/** 夜に組む計画の対象日（生活日 + 1日） */
export function planForDate(at: Date): string {
  return addDays(lifeDate(at), 1);
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d) + days * DAY_MS));
}

/** b - a の日数（'YYYY-MM-DD' 同士） */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** JST の 'HH:mm' */
export function jstTime(at: Date): string {
  const w = toJstWall(at);
  return `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
}

/** 生活日の始まり（4:00）からの経過分。0:30 なら 20.5時間 = 1230 分 */
export function minutesIntoLifeDay(at: Date): number {
  const w = toJstWall(at);
  const m = w.getUTCHours() * 60 + w.getUTCMinutes();
  return (m - DAY_START_HOUR * 60 + 24 * 60) % (24 * 60);
}

/** 生活日の 20:00 以降（翌 3:59 まで）か。夜の流れの入口を出す判定 */
export function isEvening(at: Date): boolean {
  return minutesIntoLifeDay(at) >= (20 - DAY_START_HOUR) * 60;
}

/** 生活日のカレンダー上の時刻（その日 0:00 からの分。25時 = 1500 など）を実時刻の ISO にする */
export function lifeMinuteToIso(date: string, minute: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + minute * 60000 - JST_OFFSET_MS).toISOString();
}

/** 曜日（0 = 日曜）。'YYYY-MM-DD' から */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** その生活日を含む週の月曜日 */
export function weekStartMonday(date: string): string {
  const wd = weekday(date);
  return addDays(date, -((wd + 6) % 7));
}

/** 表示用：'11月4日（水）' */
/** 見出し用の短い日付（2026-11-09）：桁をそろえて「11/09（月）」。切り替えても幅が変わらないように */
export function formatShortJa(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}（${'日月火水木金土'[weekday(date)]}）`;
}

export function formatLifeDateJa(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const w = '日月火水木金土'[weekday(date)];
  return `${m}月${d}日（${w}）`;
}
