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
  /** 前回の続き（済をつけたときの「次はここから」） */
  lastNote?: { text: string; at: string };
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
}

/** 計画（1生活日に1件） */
export interface Plan {
  /** この計画を実行する生活日 */
  lifeDate: string;
  /** 'HH:mm'。使える時間帯 */
  window: { start: string; end: string };
  createdAt: string;
  source: 'night' | 'morning-quick';
  /** 並び順 = 実行順 */
  items: PlanItem[];
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
}

export interface Meta {
  key: 'meta';
  schemaVersion: typeof SCHEMA_VERSION;
  lastExportAt?: string;
  lastBackupAt?: string;
  debugNow?: string;
  onboarded: boolean;
}

/** 入力途中の自動保存 */
export interface Draft {
  key: string;
  value: string;
  updatedAt: string;
}

export const JOURNAL_MAX_LENGTH = 2000;
