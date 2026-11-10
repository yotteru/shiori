import { findGaps, fixedBlocksFor, MIN_LEN, type Gap } from './calendar';
import { addDays, weekStartMonday } from './lifeDate';
import type { GapLabel, GapLabelEntry, Plan, Routine } from './types';

// 空いていた時間の記録（2026-11-10。要件メモ「ステップの繰り返し・期日・固定の重なり」の節）。
// 自動で「何もしなかった」とは記録しない。振り返りで、過ぎた空きに任意で印を付けるだけ。
// 見せ方は中立に（灰色系・比べる言葉や目標は出さない）

export const GAP_LABELS: { key: GapLabel; label: string }[] = [
  { key: 'rest', label: '休んだ' },
  { key: 'phone', label: 'スマホ・だらだら' },
  { key: 'errand', label: '予定外の用事' },
];
export const GAP_LABEL_NAME: Record<GapLabel, string> = { rest: '休んだ', phone: 'スマホ・だらだら', errand: '予定外の用事' };

/**
 * その日の過ぎた空き（30分以上）。固定・置いた行き先を除いた、表示する時間帯の中の空き。
 * until（その日 0:00 からの分）より後は数えない（今日はいままで。15分単位に切り下げ）
 */
export function pastGaps(date: string, routines: Routine[], plan: Plan | undefined, view: { start: number; end: number }, until?: number): Gap[] {
  const to = Math.min(view.end * 60, until === undefined ? Infinity : Math.floor(until / 15) * 15);
  const from = view.start * 60;
  if (to - from < MIN_LEN) return [];
  const blocks = [
    ...fixedBlocksFor(date, routines, plan),
    ...(plan?.items ?? []).filter((i) => typeof i.start === 'number').map((i) => ({ start: i.start!, min: i.minutes })),
  ];
  // いまより後に始まる予定は見ない（findGaps は最後の空きしか to で切らないため）。切ったあと30分未満になった空きは除く
  return findGaps(
    blocks.filter((b) => b.start < to),
    { from, to, minLen: MIN_LEN },
  )
    .map((g) => ({ start: g.start, len: Math.min(g.len, to - g.start) }))
    .filter((g) => g.len >= MIN_LEN);
}

/** その空きに付いている印（始まりが同じもの） */
export function labelOf(gap: Gap, labels: GapLabelEntry[] = []): GapLabel | undefined {
  return labels.find((l) => l.start === gap.start)?.label;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export interface GapBreakdown {
  total: number;
  byLabel: Record<GapLabel, number>;
  /** 印を付けていない空き */
  none: number;
}

/** 空きの内訳（分）。印は今の空きと重なる部分だけ数える（あとで予定を置いて空きが変わっても数えすぎない） */
export function gapBreakdown(gaps: Gap[], labels: GapLabelEntry[] = []): GapBreakdown {
  const byLabel: Record<GapLabel, number> = { rest: 0, phone: 0, errand: 0 };
  let total = 0;
  let labeled = 0;
  for (const g of gaps) {
    total += g.len;
    for (const l of labels) {
      const m = overlap(g.start, g.start + g.len, l.start, l.start + l.min);
      byLabel[l.label] += m;
      labeled += m;
    }
  }
  return { total, byLabel, none: Math.max(0, total - labeled) };
}

/** 印を付ける・外す（同じ始まりの印は置き換え） */
export function withGapLabel(labels: GapLabelEntry[] = [], gap: Gap, label: GapLabel | undefined): GapLabelEntry[] {
  const rest = labels.filter((l) => l.start !== gap.start);
  return label ? [...rest, { start: gap.start, min: gap.len, label }].sort((a, b) => a.start - b.start) : rest;
}

/** 計画のある日だけを数える（計画のない日は一日じゅう空きになり、実感と合わないため） */
function dayBreakdown(date: string, plans: Plan[], routines: Routine[], view: { start: number; end: number }, today: string, nowMin: number): GapBreakdown | undefined {
  const plan = plans.find((p) => p.lifeDate === date);
  if (!plan || date > today) return undefined;
  return gapBreakdown(pastGaps(date, routines, plan, view, date === today ? nowMin : undefined), plan.gapLabels);
}

/** 週ごとの空きの内訳（古い順、最後が今週） */
export function weeklyGapBreakdown(plans: Plan[], routines: Routine[], view: { start: number; end: number }, today: string, nowMin: number, weeks = 8): { monday: string; b: GapBreakdown }[] {
  const thisMonday = weekStartMonday(today);
  const out: { monday: string; b: GapBreakdown }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDays(thisMonday, -7 * w);
    const b: GapBreakdown = { total: 0, byLabel: { rest: 0, phone: 0, errand: 0 }, none: 0 };
    for (let i = 0; i < 7; i++) {
      const d = dayBreakdown(addDays(monday, i), plans, routines, view, today, nowMin);
      if (!d) continue;
      b.total += d.total;
      b.none += d.none;
      for (const k of Object.keys(b.byLabel) as GapLabel[]) b.byLabel[k] += d.byLabel[k];
    }
    out.push({ monday, b });
  }
  return out;
}

/** ある印が付いた時間を、1時間ごとに合計する（直近 days 日。時間帯の傾向） */
export function labelByHour(plans: Plan[], label: GapLabel, today: string, days = 28): Record<number, number> {
  const out: Record<number, number> = {};
  const from = addDays(today, -(days - 1));
  for (const p of plans) {
    if (p.lifeDate < from || p.lifeDate > today) continue;
    for (const l of p.gapLabels ?? []) {
      if (l.label !== label) continue;
      for (let h = Math.floor(l.start / 60); h * 60 < l.start + l.min; h++) {
        const m = overlap(l.start, l.start + l.min, h * 60, h * 60 + 60);
        if (m) out[h] = (out[h] ?? 0) + m;
      }
    }
  }
  return out;
}
