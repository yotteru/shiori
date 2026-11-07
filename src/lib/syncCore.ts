import type { Journal, Leftover, Plan, PlanItem, Step, Track } from './types';

// 同期の決まりごと（端末とサーバーに依存しない部分）

export type SyncKind = 'track' | 'step' | 'plan' | 'journal' | 'leftover';
export type SyncRecord = Track | Step | Plan | Journal | Leftover;

/** 同期するテーブル。下書き・Meta・鍵は端末ごとのものなので同期しない */
export const KIND_BY_TABLE: Record<string, SyncKind> = {
  tracks: 'track',
  steps: 'step',
  plans: 'plan',
  journals: 'journal',
  leftovers: 'leftover',
};
export const TABLE_BY_KIND: Record<SyncKind, string> = {
  track: 'tracks',
  step: 'steps',
  plan: 'plans',
  journal: 'journals',
  leftover: 'leftovers',
};

export function recordKey(kind: SyncKind, id: string): string {
  return `${kind}:${id}`;
}

const isNewer = (a?: string, b?: string) => (a ?? '') > (b ?? '');

function sameItem(a: PlanItem, b: PlanItem): boolean {
  const strip = ({ updatedAt: _u, ...rest }: PlanItem) => {
    void _u;
    return JSON.stringify(rest, Object.keys(rest).sort());
  };
  return strip(a) === strip(b);
}

/** 保存のたびに、中身が変わった行き先にだけ実時刻を付ける */
export function stampPlanItems(prev: Plan | undefined, next: Plan, at: string): Plan {
  const old = new Map((prev?.items ?? []).map((i) => [i.id, i]));
  return {
    ...next,
    items: next.items.map((item) => {
      const o = old.get(item.id);
      if (o && sameItem(o, item)) return { ...item, updatedAt: o.updatedAt ?? item.updatedAt ?? at };
      return { ...item, updatedAt: at };
    }),
  };
}

/**
 * 計画の取り込み：行き先ごとに後から変えた方を残す。
 * 時間帯・並び順は後から保存された計画に従い、片方にしかない行き先は
 * もう片方の計画がそれより後に保存されていれば「外した」とみなす
 */
export function mergePlans(local: Plan, remote: Plan): Plan {
  const [newer, older] = isNewer(remote.updatedAt, local.updatedAt) ? [remote, local] : [local, remote];
  const olderById = new Map(older.items.map((i) => [i.id, i]));
  const newerIds = new Set(newer.items.map((i) => i.id));
  const items: PlanItem[] = newer.items.map((n) => {
    const o = olderById.get(n.id);
    return o && isNewer(o.updatedAt, n.updatedAt) ? o : n;
  });
  for (const o of older.items) {
    if (newerIds.has(o.id)) continue;
    // 後から保存された側がこの行き先を知った上で外した → 外す
    if (!isNewer(o.updatedAt, newer.updatedAt)) continue;
    items.push(o);
  }
  return { ...newer, items, updatedAt: [local.updatedAt ?? '', remote.updatedAt ?? ''].sort().pop() || undefined };
}

export type ApplyDecision = { action: 'keep-local' } | { action: 'put'; value: SyncRecord; pushBack: boolean } | { action: 'delete' };

/** サーバーから来た1件を、端末の1件とどう合わせるか */
export function decideApply(
  kind: SyncKind,
  local: SyncRecord | undefined,
  remote: { deleted: boolean; updatedAt: string; value?: SyncRecord },
): ApplyDecision {
  const localAt = (local as { updatedAt?: string } | undefined)?.updatedAt;
  if (remote.deleted) {
    if (local && !isNewer(localAt, remote.updatedAt)) return { action: 'delete' };
    return { action: 'keep-local' };
  }
  const value = remote.value!;
  if (!local) return { action: 'put', value, pushBack: false };
  if (kind === 'plan') {
    const merged = mergePlans(local as Plan, value as Plan);
    const same = JSON.stringify(merged) === JSON.stringify(value);
    const sameAsLocal = JSON.stringify(merged) === JSON.stringify(local);
    if (sameAsLocal) return { action: 'keep-local' };
    return { action: 'put', value: merged, pushBack: !same };
  }
  if (isNewer(remote.updatedAt, localAt)) return { action: 'put', value, pushBack: false };
  return { action: 'keep-local' };
}
