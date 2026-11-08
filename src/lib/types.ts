// データの定義（指示書 §2.2、schemaVersion: 1）

export const SCHEMA_VERSION = 1 as const;

/** 取り組み（旧称「トラック」） */
export interface Track {
  id: string;
  name: string;
  type: 'project' | 'habit';
  createdAt: string;
  archivedAt?: string;
  /** 習慣型の既定値 */
  defaultMinutes?: number;
  defaultFirstStep?: string;
  /** 習慣型の既定値：きっかけ（例：帰宅して靴を脱いだら） */
  defaultCue?: string;
  /** なりたい状態（どうなったら「できた」か。メモ箱から整えたときなど。空欄可） */
  goal?: string;
  /** 前回の続き（済をつけたときの「次はここから」） */
  lastNote?: { text: string; at: string };
  /** 同期用：最後に変更した実時刻（自動で付く） */
  updatedAt?: string;
}

/** プロジェクト型のステップ（地図のマス） */
export interface Step {
  id: string;
  trackId: string;
  order: number;
  title: string;
  minutes: number;
  firstStep: string;
  status: 'todo' | 'done';
  doneAt?: string;
  updatedAt?: string;
}

/** 計画（1生活日に1件） */
export interface Plan {
  /** この計画を実行する生活日 */
  lifeDate: string;
  /** 'HH:mm'。使える時間帯 */
  window: { start: string; end: string };
  createdAt: string;
  source: 'night' | 'morning-quick';
  /** 並び順。2026-11-08 からは各行き先の開始時刻（start）の順が実行順 */
  items: PlanItem[];
  /** いつもの固定への、この日だけの変更（動かした時刻、または外した） */
  fixedEdits?: Record<string, { start: number; min: number } | 'removed'>;
  /** この日だけの固定の予定（例：歯医者） */
  extraFixed?: ExtraFixed[];
  /** 祝日・有休など、この日を休日として扱う */
  holiday?: boolean;
  /** 前の晩の準備（最初の行き先のために今夜やること） */
  prep?: { text: string; doneAt?: string };
  updatedAt?: string;
}

/** この日だけの固定の予定 */
export interface ExtraFixed {
  id: string;
  title: string;
  /** その日の 0:00 からの分（翌日にまたがるときは 1440 以上） */
  start: number;
  min: number;
}

/** いつもの固定（設定タブで決める。曜日ごとに毎日自動で置かれる） */
export interface Routine {
  id: string;
  title: string;
  /** その日の 0:00 からの分 */
  start: number;
  min: number;
  /** 0 = 日曜 … 6 = 土曜 */
  days: number[];
  createdAt: string;
  updatedAt?: string;
}

export interface PlanItem {
  id: string;
  trackId: string;
  stepId?: string;
  title: string;
  minutes: number;
  firstStep: string;
  status: 'planned' | 'done' | 'undone';
  doneAt?: string;
  nextNote?: string;
  /** 済をつける前の Track.lastNote（取り消しで元に戻すため。null = なかった） */
  prevLastNote?: { text: string; at: string } | null;
  /** 同期用：行き先ごとに後から変えた方を残すための実時刻 */
  updatedAt?: string;
  /** カレンダー上の開始時刻（その日の 0:00 からの分）。古い計画にはないので window から割り付ける */
  start?: number;
  /** きっかけ（「〜したら」→ 最初の一手） */
  cue?: string;
}

/**
 * 始めた記録（2026-11-08「5分だけで始める」の見直し）。
 * 計画の行き先から始めたとき（planItemId・trackId あり）と、計画なしの「その場の5分」（quick）がある。
 * 時間は始めてから「済」「ここまで」までの実際の時間で数える。回数は1件 = 1回
 */
export interface StartSession {
  id: string;
  /** 始めた生活日 */
  lifeDate: string;
  /** 始めた実時刻 */
  startedAt: string;
  /** 終えた実時刻（済・ここまで） */
  endedAt?: string;
  outcome?: 'done' | 'stopped';
  /** ここまでにした理由（任意のワンタップ） */
  reason?: string;
  title: string;
  planItemId?: string;
  trackId?: string;
  /** 計画なしの「その場の5分」（仕事など）。取り組みの合計には入れず、回数だけ数える */
  quick?: boolean;
  /** 5分後の知らせの予約（取り消し用） */
  pushId?: string;
  updatedAt?: string;
}

/** メモ箱（2026-11-08）：思いついたことを1行で放り込む。候補には出ない。整えると取り組みになる */
export interface Memo {
  id: string;
  text: string;
  createdAt: string;
  /** 取り組みにしたとき、その取り組み */
  trackId?: string;
  madeAt?: string;
  updatedAt?: string;
}

/** ジャーナル（1生活日に1件） */
export interface Journal {
  lifeDate: string;
  text: string;
  updatedAt: string;
}

/** やり残し（未になった計画項目） */
export interface Leftover {
  id: string;
  fromLifeDate: string;
  item: PlanItem;
  shelvedAt?: string;
  updatedAt?: string;
}

export interface Meta {
  key: 'meta';
  schemaVersion: typeof SCHEMA_VERSION;
  lastExportAt?: string;
  lastBackupAt?: string;
  debugNow?: string;
  onboarded: boolean;
  /** Supabase へ送れなかった「計画した日付」。次回保存時に再送する */
  pendingPings?: string[];
  /** 端末間の同期を使っているか */
  syncEnabled?: boolean;
  /** カレンダーに表示する時間帯（時）と、開いたときの位置（時）。端末ごと */
  calendarView?: { start: number; end: number; focus: number };
  /** 「始める」でショートカット（集中モード）を呼ぶか。端末ごと */
  focusShortcut?: boolean;
  /** 「ここまで」の理由の候補。端末ごと */
  stopReasons?: string[];
  /** 予定の開始時刻の通知（2026-11-08）。端末ごと */
  startReminder?: {
    enabled: boolean;
    /** 何分前に知らせるか（0 = 開始時刻ちょうど） */
    leadMinutes: number;
    /** すべての行き先か、その日の最初の行き先だけか */
    target: 'all' | 'first';
    /** 文面。{行き先} が行き先の名前に置きかわる */
    template: string;
  };
  /** 同期で最後に取り込んだサーバー時刻 */
  syncCursor?: string;
  lastSyncAt?: string;
}

/** 入力途中の自動保存 */
export interface Draft {
  key: string;
  value: string;
  updatedAt: string;
}

export const JOURNAL_MAX_LENGTH = 2000;
