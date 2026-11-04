import { diffDays } from './lifeDate';
import type { Leftover } from './types';

// やり残しは 3生活日以内なら候補に出し、過ぎたら保留へ移す（指示書 §2.3）
export const LEFTOVER_ACTIVE_DAYS = 3;

/** 候補に出してよいやり残しか */
export function isLeftoverActive(l: Leftover, today: string): boolean {
  if (l.shelvedAt) return false;
  const age = diffDays(l.fromLifeDate, today);
  return age >= 0 && age <= LEFTOVER_ACTIVE_DAYS;
}

/** 保留に移すべきやり残しか */
export function shouldShelve(l: Leftover, today: string): boolean {
  return !l.shelvedAt && diffDays(l.fromLifeDate, today) > LEFTOVER_ACTIVE_DAYS;
}

/** 保留に移すやり残しに shelvedAt を付けた一覧を返す（変更のあったものだけ） */
export function shelveExpired(leftovers: Leftover[], today: string, nowIso: string): Leftover[] {
  return leftovers.filter((l) => shouldShelve(l, today)).map((l) => ({ ...l, shelvedAt: nowIso }));
}

/**
 * 保留から候補に戻す。fromLifeDate を今日に付け替えて、また3日間候補に出す
 * （元の日付のままだと次の判定ですぐ保留に戻ってしまうため）
 */
export function unshelve(l: Leftover, today: string): Leftover {
  const { shelvedAt: _drop, ...rest } = l;
  void _drop;
  return { ...rest, fromLifeDate: today };
}
