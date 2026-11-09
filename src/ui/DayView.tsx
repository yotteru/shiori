import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLive, useNow } from '../hooks';
import { revertDone, type SavePlanResult } from '../lib/actions';
import {
  DEFAULT_VIEW,
  findGaps,
  fixedBlocksFor,
  formatDuration,
  formatMinute,
  itemsByStart,
  nextItem,
  placeStart,
  removedFixedFor,
  weeklyDoneMinutes,
  type Gap,
} from '../lib/calendar';
import {
  addExtraFixed,
  confirmPlan,
  editStart,
  setPrep,
  moveExtraFixed,
  moveItem,
  placeCandidate,
  placeIntents,
  removeExtraFixed,
  removeItem,
  setFixedEdit,
} from '../lib/calendarActions';
import { buildCandidates, candidateKey, lastDoneByTrack, morningCandidates, type Candidate } from '../lib/candidates';
import { nowIso, toDate } from '../lib/clock';
import { db, getMeta } from '../lib/db';
import { shelveExpired } from '../lib/leftovers';
import { cancelPush, pushPermission, schedulePush } from '../lib/push';
import { activeSession } from '../lib/records';
import { deadlineLabel } from '../lib/tracks';
import { focusMinutes, focusShortcutUrl } from '../lib/shortcut';
import { autoEndAt, autoEndSessions, DEFAULT_STOP_REASONS, discardSession, endSession, setSessionPush, startSession, stopSession } from '../lib/starts';
import { addDays, jstTime, lifeDate, minutesIntoLifeDay, formatShortJa } from '../lib/lifeDate';
import type { Plan, PlanItem, StartSession } from '../lib/types';
import { NightFinishedExtras } from './Backup';
import { Calendar, PX_PER_MIN, type CalBlock } from './Calendar';
import { EndSelect, Sheet, TimeSelect, Toast } from './common';
import { DoneSheet } from './DoneSheet';
import { JournalCard, ReviewCard } from './Reflection';
import { allocationItems, DaySheet, loadWeekMode, saveWeekMode, WeekBody, weekLabel, weekTitle } from './WeekView';
import { slideTo, useSwipe } from './useSwipe';
import { allDayEvents, defaultWeekOffset, weekDates } from '../lib/week';

// しおりタブ（2026-11-08 カレンダー版）。「今日」「明日」をいつでも切り替えて、縦のカレンダーで組む

type Day = 'today' | 'tomorrow' | 'week';
const DAY_ORDER: Day[] = ['today', 'tomorrow', 'week'];
type SheetKind = null | 'reflect' | 'first' | 'confirmed' | 'quick' | 'stop';
const TAB_H = 56;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

export function DayView() {
  const now = useNow();
  const today = lifeDate(now);
  const [day, setDay] = useState<Day>('today');
  const date = day === 'today' ? today : addDays(today, 1);
  const source: Plan['source'] = day === 'today' ? 'morning-quick' : 'night';

  const data = useLive(
    async () => ({
      yesterday: await db.plans.get(addDays(today, -1)),
      journal: await db.journals.get(today),
      plans: await db.plans.toArray(),
      tracks: await db.tracks.toArray(),
      steps: await db.steps.toArray(),
      leftovers: await db.leftovers.toArray(),
      routines: await db.routines.toArray(),
      meta: await getMeta(),
      starts: await db.starts.toArray(),
    }),
    [today],
  );

  const [sel, setSel] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [doneFor, setDoneFor] = useState<PlanItem | null>(null);
  const [toast, setToast] = useState<{ message: string; undoId?: string } | null>(null);
  const [confirmed, setConfirmed] = useState<SavePlanResult | null>(null);
  const [topH, setTopH] = useState(0);
  const [dockH, setDockH] = useState(140);
  const [swipeEl, setSwipeEl] = useState<HTMLDivElement | null>(null);
  const [weekOffset, setWeekOffset] = useState(() => defaultWeekOffset(today, Number(jstTime(now).slice(0, 2))));
  const [weekMode, setWeekModeState] = useState<'cal' | 'list'>(loadWeekMode);
  const [weekOpen, setWeekOpen] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [addFixedAt, setAddFixedAt] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // 3生活日を過ぎたやり残しを保留へ移す
  useEffect(() => {
    db.transaction('rw', db.leftovers, async () => {
      const moved = shelveExpired(await db.leftovers.toArray(), today, nowIso());
      if (moved.length) await db.leftovers.bulkPut(moved);
    });
  }, [today]);

  // 済・ここまでを押さなくても、予定の終わり（その場の5分は30分）を過ぎたら自動で終える（2026-11-09）
  const minuteKey = Math.floor(now.getTime() / 60000);
  useEffect(() => {
    void autoEndSessions();
  }, [minuteKey]);

  // 見出しは画面の上に重ねて固定。その高さぶん、ページの上を空けておく
  useLayoutEffect(() => {
    const el = topRef.current;
    if (el && el.offsetHeight !== topH) setTopH(el.offsetHeight);
    const d = dockRef.current;
    if (d && d.offsetHeight !== dockH) setDockH(d.offsetHeight);
  });


  const view = data?.meta.calendarView ?? DEFAULT_VIEW;
  const nowMin = minutesIntoLifeDay(now) + 4 * 60;
  // 0時〜4時はしおりの上ではまだ前の日（25時など）。その間、実際の時刻は「明日」のカレンダーの 0:00〜4:00 にあたる（2026-11-09）
  const nowOnDay = day === 'today' ? nowMin : day === 'tomorrow' && nowMin >= 24 * 60 ? nowMin - 24 * 60 : undefined;

  const scrollToMinute = (m: number, smooth = false) => {
    const grid = document.querySelector('.cal-grid');
    if (!grid) return;
    const y = grid.getBoundingClientRect().top + window.scrollY + (m - view.start * 60) * PX_PER_MIN - (topRef.current?.offsetHeight ?? 0) - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  };

  // 開いたとき・今日と明日を切り替えたとき：今日は「いま」の少し前、明日は設定の位置へ
  const loaded = !!data;
  useLayoutEffect(() => {
    if (!loaded) return;
    if (day === 'week') window.scrollTo(0, 0);
    else scrollToMinute(nowOnDay !== undefined ? nowOnDay - 90 : view.focus * 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, loaded]);

  // 横スライドで 今日 ⇄ 明日 ⇄ 週（2026-11-09）
  const dayIdx = DAY_ORDER.indexOf(day);
  const switchDay = useCallback(
    (dir: 'left' | 'right') => {
      const n = DAY_ORDER[dayIdx + (dir === 'left' ? 1 : -1)];
      if (!n) return;
      setDay(n);
      setSel(null);
      setHeld(null);
      setGap(null);
    },
    [dayIdx],
  );
  const goTo = (d: Day) => {
    const to = DAY_ORDER.indexOf(d);
    if (to === dayIdx) return;
    slideTo(swipeEl, to > dayIdx ? 'left' : 'right', () => {
      setDay(d);
      setSel(null);
      setHeld(null);
      setGap(null);
    });
  };
  useSwipe(swipeEl, { enabled: !sel, canLeft: dayIdx < 2, canRight: dayIdx > 0, onSwipe: switchDay });

  // 今日｜明日｜週は細いレール（切り替えは横スライドが主。2026-11-09）
  const segEl = (
    <div className="seg-rail" role="tablist" aria-label="今日・明日・週">
      <span className="knob" style={{ transform: `translateX(${dayIdx * 100}%)` }} aria-hidden="true" />
      {(['today', 'tomorrow', 'week'] as const).map((d) => (
        <button
          key={d}
          role="tab"
          aria-selected={day === d}
          aria-pressed={day === d}
          onClick={() => goTo(d)}
        >
          {d === 'today' ? '今日' : d === 'tomorrow' ? '明日' : '週'}
        </button>
      ))}
    </div>
  );

  if (!data) return null;

  const plan = data.plans.find((p) => p.lifeDate === date);
  const weekDates_ = weekDates(today, weekOffset);
  const items = plan ? itemsByStart(plan) : [];
  const next = day === 'today' && plan ? nextItem(plan) : undefined;
  const fixed = fixedBlocksFor(date, data.routines, plan);
  const removedFixed = removedFixedFor(date, data.routines, plan);
  const trackById = new Map(data.tracks.map((t) => [t.id, t]));
  // 同じ行き先を2回以上置いた日は、予定に「1/2」のように何回目かを出す
  const nthLabel = (i: PlanItem): string | undefined => {
    const k = candidateKey(i.trackId, i.stepId);
    const same = items.filter((x) => candidateKey(x.trackId, x.stepId) === k);
    return same.length >= 2 ? `${same.findIndex((x) => x.id === i.id) + 1}/${same.length}` : undefined;
  };

  const blocks: CalBlock[] = [
    ...fixed.map((f) => ({ id: f.id, title: f.title, start: f.start, min: f.min, tone: 'fixed' as const })),
    ...items.map((i) => ({
      id: `item:${i.id}`,
      title: i.title,
      start: i.start,
      min: i.minutes,
      tone: (trackById.get(i.trackId)?.type === 'habit' ? 'habit' : 'project') as CalBlock['tone'],
      status: i.status,
      isNext: next?.id === i.id,
      nth: nthLabel(i),
      first: i.firstStep,
      cue: i.cue,
    })),
  ];
  // 「いま」の線がある日（今日、0時〜4時の明日）は、いまより後の空きだけ。それ以外は表示する時間帯の全体
  const gaps = findGaps(blocks, { from: nowOnDay !== undefined ? Math.max(view.start * 60, Math.ceil((nowOnDay + 1) / 15) * 15) : view.start * 60, to: view.end * 60 });

  // 候補（今日は前回の続きが新しい順）
  const all = buildCandidates({ today, tracks: data.tracks, steps: data.steps, leftovers: data.leftovers });
  const ordered = day === 'today' ? morningCandidates(all, data.tracks, lastDoneByTrack(data.plans, data.steps), all.length) : all;
  // 週の見通しで、この日に札を付けた取り組みを先頭に（2026-11-09）
  const intents = plan?.intents ?? [];
  const cands = [...ordered.filter((c) => intents.includes(c.trackId)), ...ordered.filter((c) => !intents.includes(c.trackId))];
  // 同じ行き先（プロジェクト型のステップも）を1日に何回でも置ける。何回置いたかを札と予定に出す（2026-11-10）
  const placedCount = new Map<string, number>();
  for (const i of items) {
    const k = candidateKey(i.trackId, i.stepId);
    placedCount.set(k, (placedCount.get(k) ?? 0) + 1);
  }
  const heldCand = cands.find((c) => c.key === held);

  const weekly = weeklyDoneMinutes(data.plans, today, data.starts);
  const activeTracks = data.tracks.filter((t) => !t.archivedAt && t.type !== 'number');
  const allocItems = allocationItems(data.plans, weekDates_, activeTracks);
  const setWeekMode = (m: 'cal' | 'list') => {
    setWeekModeState(m);
    saveWeekMode(m);
  };
  const unplacedIntents = (plan?.intents ?? []).filter((id) => !items.some((i) => i.trackId === id) && cands.some((c) => c.trackId === id)).length;
  const pendingYesterday = data.yesterday?.items.some((i) => i.status === 'planned') ? data.yesterday : undefined;
  // 始めて、まだ終えていないもの（画面のタイマーは置かない。2026-11-08）
  // 自動で終える時刻を過ぎたものは、書き込みを待たずに終えたものとして扱う
  const realNow = new Date().toISOString();
  const active = activeSession(data.starts.filter((s) => autoEndAt(s, data.plans) > realNow));
  // その場の5分で始めた印（今日のカレンダーだけ。2026-11-09）
  const marks =
    day === 'today'
      ? data.starts
          .filter((s) => s.quick && s.lifeDate === today)
          .map((s) => ({ id: s.id, minute: minutesIntoLifeDay(toDate(s.startedAt)) + 4 * 60, title: s.title, live: s.id === active?.id }))
      : [];
  const activeItem = active?.planItemId ? data.plans.flatMap((p) => p.items).find((i) => i.id === active.planItemId) : undefined;

  const begin = async (input: Pick<StartSession, 'title' | 'planItemId' | 'trackId' | 'quick'>, plannedMinutes?: number) => {
    // 前のものは startSession の中で自動で終わる。その5分の知らせだけ取り消す
    if (active?.pushId) void cancelPush(active.pushId);
    const s = await startSession({ lifeDate: today, ...input });
    // 5分後の知らせ（Web プッシュ）。通知の準備がない・圏外のときは、知らせなしで始める
    const pushId = await schedulePush('five_min', 300);
    if (pushId) await setSessionPush(s.id, pushId);
    else
      setToast({
        message:
          pushPermission() === 'granted'
            ? '5分の知らせを予約できませんでした（電波を確かめてください）'
            : '設定の「5分の知らせ」で通知を受け取ると、5分後に知らせます',
      });
    // 集中モード（ショートカット「しおり5分」）。自動では切れない（終わったら Watch から切る）。
    // しおりには戻らないので、そのまま画面を消せばよい
    if (data.meta.focusShortcut) window.location.href = focusShortcutUrl(focusMinutes(plannedMinutes));
  };

  const finish = async (s: StartSession, outcome: 'done' | 'stopped') => {
    if (s.pushId) void cancelPush(s.pushId);
    if (outcome === 'done') await endSession(s.id, 'done');
  };

  const selected = sel ? blocks.find((b) => b.id === sel) : undefined;
  const selItem = sel?.startsWith('item:') ? items.find((i) => `item:${i.id}` === sel) : undefined;
  const selFixed = sel && !sel.startsWith('item:') ? fixed.find((f) => f.id === sel) : undefined;

  const place = async (c: Candidate, at: number) => {
    const item = await placeCandidate(date, source, c, placeStart(at, Math.max(30, c.minutes), view), db);
    setHeld(null);
    setGap(null);
    setSel(`item:${item.id}`);
  };

  const commit = async (id: string, start: number, min: number) => {
    if (id.startsWith('item:')) await moveItem(date, id.slice(5), start, min);
    else if (id.startsWith('routine:')) await setFixedEdit(date, id.slice(8), { start, min }, source);
    else if (id.startsWith('extra:')) await moveExtraFixed(date, id.slice(6), start, min);
  };

  const removeSelected = async () => {
    if (!sel) return;
    if (selItem) await removeItem(date, selItem.id);
    else if (selFixed?.routineId) await setFixedEdit(date, selFixed.routineId, 'removed', source);
    else if (selFixed?.extraId) await removeExtraFixed(date, selFixed.extraId);
    setSel(null);
  };

  const hint = gap
    ? `${formatMinute(gap.start)}〜の空き（${formatDuration(gap.len)}）に入る候補をタップ`
    : heldCand
      ? `「${heldCand.title}」を持っています。置きたい時刻をタップ`
      : selected
        ? '本体をドラッグで移動、上下の丸で開始・終了（30分から15分刻み）'
        : day === 'today'
          ? active
            ? `${jstTime(toDate(active.startedAt))} に「${active.title}」を始めました`
            : next
              ? plan?.prep
                ? `昨夜の準備：${plan.prep.text}${plan.prep.doneAt ? '（済）' : ''}`
                : '黒い予定が次の行き先'
              : '空きをタップするか、候補を持って時刻をタップして今日を組む'
          : '「空き」をタップして埋める。候補を持って時刻をタップでもOK';

  const bottomInset = () => (dockRef.current?.offsetHeight ?? 0) + TAB_H;

  return (
    <>
      <div ref={topRef} className="cal-top">
        {/* 1行目は日付だけ（今日・明日は押すと日のシート：休日・この日だけの予定・札）。2行目に今週の合計（2026-11-09） */}
        <div className="cal-title">
          {day === 'week' ? (
            <h1>{`${weekTitle(weekDates_)} ${weekLabel(weekOffset)}`}</h1>
          ) : (
            <button className="cal-day-btn" onClick={() => setDayOpen(true)} aria-label={`${formatShortJa(date)}のシートを開く（休日・この日だけの予定・札）`}>
              <h1>{`${formatShortJa(date)} ${day === 'today' ? '今日' : '明日'}`}</h1>
              <span aria-hidden="true">▾</span>
            </button>
          )}
          {day !== 'week' && allDayEvents(plan).length > 0 && (
            <span className="cal-allday">終日：{allDayEvents(plan).map((x) => x.title).join('・')}</span>
          )}
        </div>
        <div className="row-scroll cal-sum" aria-label="今週の合計">
          {activeTracks.length ? (
            activeTracks.map((t) => (
              <span key={t.id} className={`week-chip${t.type === 'habit' ? ' h' : ' p'}`}>
                <b>{t.name}</b> <span className="mono">{formatDuration(weekly[t.id] ?? 0)}</span>
              </span>
            ))
          ) : (
            <span className="small muted">今週の合計はここに出ます</span>
          )}
        </div>
      </div>
      {/* .screen の上の余白（20px＋安全領域）を差し引き、見出しのすぐ下から始まるようにする（固定の見出しは間隔に数えない） */}
      <div style={{ height: `max(0px, calc(${topH}px - 20px - env(safe-area-inset-top)))`, marginTop: -16 }} aria-hidden="true" />

      <div ref={setSwipeEl} className="pane">
        {day === 'week' ? (
          <WeekBody dates={weekDates_} today={today} plans={data.plans} routines={data.routines} tracks={activeTracks} view={view} mode={weekMode} onOpen={setWeekOpen} />
        ) : (
      <Calendar
        view={view}
        blocks={blocks}
        gaps={gaps}
        selectedId={sel}
        holding={!!heldCand}
        gapStart={gap?.start ?? null}
        now={nowOnDay}
        onSelect={(id) => {
          setSel(id);
          setGap(null);
        }}
        onPlace={(m) => heldCand && void place(heldCand, m)}
        onGap={(g) => {
          setGap(g);
          setHeld(null);
          setSel(null);
        }}
        onCommit={(id, s, m) => void commit(id, s, m)}
        onFixedTap={(m) => {
          setGap(null);
          setAddFixedAt(m);
        }}
        removed={removedFixed}
        onRestoreFixed={async (id, title) => {
          await setFixedEdit(date, id, undefined, source);
          setToast({ message: `「${title}」を戻しました` });
        }}
        marks={marks}
        topInset={() => topRef.current?.getBoundingClientRect().bottom ?? 0}
        bottomInset={bottomInset}
      />
        )}
        <div style={{ height: dockH + 24 }} aria-hidden="true" />
      </div>

      {day !== 'week' && <nav className="cal-index" aria-label="時刻へ移動" style={{ top: topH + 8, transform: "none" }}>
        {Array.from({ length: Math.ceil((view.end - view.start) / 2) }, (_, k) => view.start + k * 2).map((h) => (
          <button key={h} onClick={() => scrollToMinute(h * 60, true)}>
            {h >= 24 ? h - 24 : h}
          </button>
        ))}
      </nav>}

      <div ref={dockRef} className="cal-dock">
        {day === 'week' ? (
          <>
            <div className="row-scroll tray alloc-row-dock">
              {allocItems.length ? (
                allocItems.map((x) => (
                  <span key={x.track.id} className={`week-chip${x.track.type === 'habit' ? ' h' : ' p'}`}>
                    <b>{x.track.name}</b> {x.days.join('・')}
                  </span>
                ))
              ) : (
                <span className="small muted">日をタップして「この日にやること」の札を付ける</span>
              )}
            </div>
            {/* 前の週・次の週の間に、カレンダー｜リストの切り替え（上は片手で届かないので下へ。2026-11-09） */}
            <div className="week-nav">
              <button className="btn" disabled={weekOffset <= -4} onClick={() => slideTo(swipeEl, 'right', () => setWeekOffset(weekOffset - 1))}>
                ‹ 前の週
              </button>
              <div className="seg-pill" role="group" aria-label="週の表示">
                <button aria-pressed={weekMode === 'cal'} onClick={() => setWeekMode('cal')}>
                  カレンダー
                </button>
                <button aria-pressed={weekMode === 'list'} onClick={() => setWeekMode('list')}>
                  リスト
                </button>
              </div>
              <button className="btn" disabled={weekOffset >= 4} onClick={() => slideTo(swipeEl, 'left', () => setWeekOffset(weekOffset + 1))}>
                次の週 ›
              </button>
            </div>
          </>
        ) : selected ? (
          <div className="selbar">
            <div className="r">
              <b>{selected.title}</b>
              <small className="mono">
                {formatMinute(selected.start)}–{formatMinute(selected.start + selected.min)}・{formatDuration(selected.min)}
              </small>
            </div>
            <div className="r">
              {selItem ? (
                selItem.status === 'done' ? (
                  <small>{selItem.doneAt ? `${jstTime(toDate(selItem.doneAt))} に済` : '済'}</small>
                ) : (
                  selItem.firstStep || selItem.cue ? (
                    <button className="link" onClick={() => setSheet('first')}>
                      {selItem.cue ? `${selItem.cue} → ` : '最初の一手：'}
                      {selItem.firstStep || '始める'}
                    </button>
                  ) : (
                    // 書いていなくても催促しない（2026-11-08）。直したいときだけ開ける
                    <button className="link" style={{ opacity: 0.7 }} onClick={() => setSheet('first')}>
                      ＋最初の一手
                    </button>
                  )
                )
              ) : (
                <small>{selFixed?.routineId ? 'いつもの固定（動かすとこの日だけ変わる）' : 'この日だけの予定'}</small>
              )}
              {selItem?.status === 'done' ? (
                <button
                  onClick={async () => {
                    await revertDone(date, selItem.id);
                    setSel(null);
                  }}
                >
                  済を取り消す
                </button>
              ) : (
                <button onClick={() => void removeSelected()}>{selFixed?.routineId ? 'この日は外す' : selFixed ? '消す' : '外す'}</button>
              )}
            </div>
          </div>
        ) : (
          <>
            {(gap || heldCand) && <div className="cal-hint on">{hint}</div>}
            <div className="row-scroll tray">
                {cands.length === 0 && <span className="small muted">候補がありません。「取り組み」から追加できます。</span>}
                {cands.map((c) => {
                  const placedN = placedCount.get(c.key) ?? 0;
                  const due = deadlineLabel({ type: c.trackType, deadline: trackById.get(c.trackId)?.deadline }, today);
                  const fit = gap ? Math.max(30, c.minutes) <= gap.len : null;
                  const cls = ['tray-cand', held === c.key ? 'held' : '', fit === true ? 'fit' : fit === false ? 'nofit' : ''].join(' ');
                  return (
                    <button
                      key={c.key}
                      className={cls}
                      onClick={() => {
                        if (gap) {
                          if (fit) void place(c, gap.start);
                          return;
                        }
                        setHeld(held === c.key ? null : c.key);
                        setSel(null);
                      }}
                    >
                      <small>
                        {intents.includes(c.trackId) && <b className="tag-mark">札</b>}
                        {c.kind === 'leftover' ? 'やり残し' : c.trackName}・{Math.max(30, c.minutes)}分
                        {due && <span className="due">・{due}</span>}
                        {placedN > 0 && (
                          <b className="cnt">
                            {day === 'today' ? '今日' : '明日'} {placedN}回
                          </b>
                        )}
                      </small>
                      <span>{c.title}</span>
                    </button>
                  );
                })}
            </div>
            {day === 'today' ? (
          active ? (
            <div className="stack" style={{ gap: 4 }}>
              <span className="small" style={{ textAlign: 'center' }}>
                {jstTime(toDate(active.startedAt))} に始めました・押さなくても {jstTime(toDate(autoEndAt(active, data.plans)))} に終わります
              </span>
              <div className="cal-two">
                <button
                  className="btn-next"
                  onClick={async () => {
                    if (activeItem && activeItem.status === 'planned') {
                      setDoneFor(activeItem);
                      return;
                    }
                    await finish(active, 'done');
                    setToast({ message: '済にしました' });
                  }}
                >
                  済
                </button>
                <button className="btn" style={{ fontWeight: 700 }} onClick={() => setSheet('stop')}>
                  ここまで
                </button>
              </div>
            </div>
          ) : next ? (
            <div className="stack" style={{ gap: 4 }}>
              {next.cue && (
                <span className="small" style={{ textAlign: 'center' }}>
                  <b>{next.cue}</b> → {next.firstStep || '始める'}
                </span>
              )}
              <div className="cal-two">
                <button className="btn-next" onClick={() => void begin({ title: next.title, planItemId: next.id, trackId: next.trackId }, next.minutes)}>
                  5分だけ始める
                </button>
                <button className="btn" style={{ fontWeight: 700 }} onClick={() => setDoneFor(next)}>
                  済をつける
                </button>
              </div>
            </div>
          ) : (
            // 次の行き先がないとき（仕事中など）は、計画にないことを5分だけ始める入口を主な操作に（2026-11-09）
            <div className="cal-two">
              <button className="btn-next" onClick={() => setSheet('quick')}>
                何か5分だけ始める
              </button>
              <button className={`btn${pendingYesterday ? ' has-dot' : ''}`} style={{ fontWeight: 700 }} onClick={() => setSheet('reflect')}>
                今日の振り返り
              </button>
            </div>
          )
            ) : (
          <div className={unplacedIntents > 0 ? 'cal-two' : 'stack'}>
          {unplacedIntents > 0 && (
            <button
              className="btn"
              onClick={async () => {
                const n = await placeIntents(date, cands, data.routines, view);
                setToast({ message: n ? `札の${n}件を空きに置きました。動かして調整できます` : '入る空きが見つかりませんでした' });
              }}
            >
              札を置く（{unplacedIntents}）
            </button>
          )}
          <button
            className="btn-primary"
            disabled={!plan || plan.items.length === 0}
            onClick={async () => {
              setConfirmed(await confirmPlan(date));
              setSheet('confirmed');
            }}
          >
            {unplacedIntents > 0 ? 'この計画で迎える' : 'この計画で明日を迎える'}
          </button>
          </div>
            )}
            {/* 今日：次の行き先があれば「5分だけ始める」の真下に「ほかのことを5分」。メモ・測るはしおりタブに置かない（2026-11-09） */}
            {day === 'today' && (active || next) && (
            <div className="dock-links">
              {next && !active ? (
                <button className="other" onClick={() => setSheet('quick')}>
                  ▶ ほかのことを5分
                </button>
              ) : (
                <span />
              )}
              <button
                className={pendingYesterday ? 'has-dot' : undefined}
                aria-label={pendingYesterday ? '振り返り（昨日の答え合わせが残っています）' : undefined}
                onClick={() => setSheet('reflect')}
              >
                振り返り
              </button>
            </div>
            )}
          </>
        )}
        {segEl}
      </div>
      {day !== 'week' && (<button
        className="cal-fab"
        style={{ bottom: `calc(${dockH + 56 + 12}px + env(safe-area-inset-bottom))` }}
        onClick={() => scrollToMinute(nowOnDay !== undefined ? nowOnDay - 60 : view.focus * 60, true)}
      >
        {nowOnDay !== undefined ? 'いま' : `${view.focus}時`}
      </button>)}

      {weekOpen && <DaySheet date={weekOpen} plan={data.plans.find((p) => p.lifeDate === weekOpen)} routines={data.routines} tracks={activeTracks} onClose={() => setWeekOpen(null)} />}
      {dayOpen && day !== 'week' && <DaySheet date={date} plan={plan} routines={data.routines} tracks={activeTracks} source={source} onClose={() => setDayOpen(false)} />}
      {addFixedAt !== null && (
        <AddFixedSheet
          date={date}
          start={addFixedAt}
          onAdd={async (title, start, min) => {
            await addExtraFixed(date, title, start, min, source);
            setAddFixedAt(null);
            setToast({ message: `「${title}」をこの日だけの予定に足しました` });
          }}
          onClose={() => setAddFixedAt(null)}
        />
      )}
      {sheet === 'reflect' && (
        <Sheet onClose={() => setSheet(null)} label="今日の振り返り">
          <span style={{ fontSize: 16, fontWeight: 700 }}>今日の振り返り</span>
          {pendingYesterday && (
            <ReviewCard
              key={`y-${pendingYesterday.items.map((i) => i.status).join()}`}
              plan={pendingYesterday}
              title="昨日の答え合わせが残っています"
              note="昨日の行き先を済か未に決めてください。未にしたものは、今日の候補の先頭に並びます。"
            />
          )}
          {plan && plan.items.length > 0 ? (
            <ReviewCard key={plan.items.map((i) => i.status).join()} plan={plan} title="答え合わせ" />
          ) : (
            <p className="sub">今日の行き先はまだありません。</p>
          )}
          <JournalCard key={today} lifeDate={today} saved={data.journal?.text ?? ''} />
          <button className="btn-primary" onClick={() => setSheet(null)}>
            閉じる
          </button>
        </Sheet>
      )}
      {sheet === 'first' && selItem && (
        <FirstStepSheet
          key={selItem.id}
          initial={selItem.firstStep}
          title={selItem.title}
          onSave={async (v) => {
            await editStart(date, selItem.id, { firstStep: v.trim() });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'confirmed' && confirmed && (
        <Sheet onClose={() => setSheet(null)} label="明日のルートができました">
          <span style={{ fontSize: 18, fontWeight: 700 }}>明日のルートができました</span>
          {items[0] && (
            <section className="next-card">
              <span className="kicker">明日の最初の行き先・{formatMinute(items[0].start)}</span>
              <span className="t">{items[0].title}</span>
              {items[0].firstStep && <span style={{ fontSize: 14 }}>最初の一手：{items[0].firstStep}</span>}
            </section>
          )}
          {items[0] && <PrepCard key={date} date={date} title={items[0].title} prep={plan?.prep} />}
          <NightFinishedExtras />
          {confirmed.ping === 'failed' && <p className="small muted">計画した日付をサーバーに送れませんでした。次回もう一度送ります。</p>}
          {confirmed.backup === 'failed' && <p className="small muted">自動バックアップに失敗しました。次回もう一度行います。</p>}
          <button className="btn-primary" onClick={() => setSheet(null)}>
            閉じる
          </button>
        </Sheet>
      )}
      {sheet === 'quick' && (
        <QuickSheet
          onStart={async (title) => {
            setSheet(null);
            await begin({ title, quick: true });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'stop' && active && (
        <StopSheet
          session={active}
          reasons={data.meta.stopReasons ?? DEFAULT_STOP_REASONS}
          onStop={async (reason, note) => {
            await finish(active, 'stopped');
            await stopSession(active.id, reason, note);
            setSheet(null);
            setToast({ message: 'ここまでにしました。始めた1回として残ります' });
          }}
          onDiscard={async () => {
            if (active.pushId) void cancelPush(active.pushId);
            await discardSession(active.id);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {doneFor && (
        <DoneSheet
          item={doneFor}
          lifeDate={date}
          habit={trackById.get(doneFor.trackId)?.type === 'habit'}
          onClose={() => setDoneFor(null)}
          onDone={() => {
            if (active && active.planItemId === doneFor.id) void finish(active, 'done');
            setToast({ message: '済をつけました', undoId: doneFor.id });
            setDoneFor(null);
          }}
        />
      )}
      {toast && (
        <Toast
          message={toast.message}
          action={toast.undoId ? '取り消す' : undefined}
          onAction={async () => {
            if (toast.undoId) await revertDone(date, toast.undoId);
            setToast(null);
          }}
          onTimeout={() => setToast(null)}
        />
      )}
    </>
  );
}

function FirstStepSheet({
  initial,
  title,
  onSave,
  onClose,
}: {
  initial: string;
  title: string;
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <Sheet onClose={onClose} label="最初の一手">
      <span className="sub">{title}</span>
      <label className="field">
        <span>最初の一手</span>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="例：バッグを持って家を出る" />
        <span className="small muted">ふだんは前回の「次はここから」が自動で入ります。この日だけ変えたいときに書き換えてください。</span>
      </label>
      <button className="btn-primary" onClick={() => onSave(v)}>
        保存
      </button>
      <button className="btn-ghost" onClick={onClose}>
        やめる
      </button>
    </Sheet>
  );
}

/** 左の固定の列をタップしたとき：その時刻で「この日だけの予定」を足す（2026-11-09） */
function AddFixedSheet({ date, start, onAdd, onClose }: { date: string; start: number; onAdd: (title: string, start: number, min: number) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [s, setS] = useState(formatMinute(start));
  const [end, setEnd] = useState(start + 60);
  const sm = toMin(s);
  return (
    <Sheet onClose={onClose} label="この日だけの予定を足す">
      <span style={{ fontSize: 18, fontWeight: 700 }}>{formatShortJa(date)} の予定を足す</span>
      <span className="sub">歯医者・飲み会など、この日だけの決まった予定。左の固定の列に置かれます。</span>
      <input className="input" value={title} placeholder="例：歯医者" aria-label="予定の名前" onChange={(e) => setTitle(e.target.value)} />
      <div className="row">
        <TimeSelect
          label="開始"
          value={s}
          onChange={(v) => {
            setS(v);
            if (end < toMin(v) + 30) setEnd(toMin(v) + 60);
          }}
        />
        <span className="small muted">〜</span>
        <EndSelect start={sm} value={end} onChange={setEnd} />
      </div>
      <button className="btn-primary" disabled={!title.trim()} onClick={() => onAdd(title.trim(), sm, Math.max(30, end - sm))}>
        足す
      </button>
      <button className="btn-ghost" onClick={onClose}>
        やめる
      </button>
    </Sheet>
  );
}

/** その場の5分：計画にないこと（仕事など）を、名前1行だけで始める */
function QuickSheet({ onStart, onClose }: { onStart: (title: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  return (
    <Sheet onClose={onClose} label="計画にないことを5分だけ">
      <span style={{ fontSize: 18, fontWeight: 700 }}>計画にないことを5分だけ</span>
      <span className="sub">仕事でも家のことでも、とりあえず5分だけ始めます。カレンダーに小さな印が付き、回数だけ記録します（取り組みの時間には入れません）。</span>
      <label className="field">
        <span>何をする？</span>
        <input className="input" value={title} placeholder="例：見積書の下書き" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button className="btn-next" disabled={!title.trim()} onClick={() => onStart(title.trim())}>
        5分だけ始める
      </button>
      <button className="btn-ghost" onClick={onClose}>
        やめる
      </button>
    </Sheet>
  );
}

/** ここまで：やめるのは約束どおり。「次はここから」と理由はどちらも任意 */
function StopSheet({
  session,
  reasons,
  onStop,
  onDiscard,
  onClose,
}: {
  session: StartSession;
  reasons: string[];
  onStop: (reason: string | undefined, note: string) => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | undefined>();
  const [note, setNote] = useState('');
  return (
    <Sheet onClose={onClose} label="ここまでにする">
      <div className="head">
        <span className="sub">ここまでにする</span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{session.title}</span>
      </div>
      <span className="small muted">始めたこと自体が1回として残ります。行き先は未のまま残るので、あとで続きからできます。</span>
      {session.trackId && (
        <label className="field">
          <span>次はここから（空欄でも大丈夫）</span>
          <input className="input" value={note} placeholder="例：配管が壁を跨ぐときの判定から" onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <div className="field">
        <span>理由（選ばなくても大丈夫）</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {reasons.map((r) => (
            <button
              key={r}
              className={`chip-btn${reason === r ? ' accent' : ''}`}
              aria-pressed={reason === r}
              onClick={() => setReason(reason === r ? undefined : r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <button className="btn-primary" onClick={() => onStop(reason, note)}>
        ここまでにする
      </button>
      <button className="btn-ghost" onClick={onClose}>
        まだ続ける
      </button>
      <button className="btn-ghost" onClick={onDiscard}>
        間違えて始めた（記録を消す）
      </button>
    </Sheet>
  );
}

/** 前の晩の準備：明日の最初の行き先のために、今夜できることを1つ */
function PrepCard({ date, title, prep }: { date: string; title: string; prep?: { text: string; doneAt?: string } }) {
  const [text, setText] = useState(prep?.text ?? '');
  if (prep?.doneAt) {
    return (
      <div className="card">
        <span className="label">今夜の準備</span>
        <span>
          {prep.text} <span className="stamp" style={{ marginLeft: 6 }}>済</span>
        </span>
        <span className="small muted">明日の朝の手間が1つ減りました。</span>
      </div>
    );
  }
  return (
    <div className="card">
      <span className="label">今夜できる準備を1つ</span>
      <span className="small muted">「{title}」を始める前の手間を、今夜のうちに1つ済ませておきます（例：バッグを玄関に置く、試行モデルを生成しておく）。</span>
      <input className="input" value={text} placeholder="例：バッグを玄関に置く" onChange={(e) => setText(e.target.value)} />
      <div className="cal-two">
        <button className="btn-next" disabled={!text.trim()} onClick={() => setPrep(date, { text, doneAt: nowIso() })}>
          今夜やった
        </button>
        <button className="btn" disabled={!text.trim()} onClick={() => setPrep(date, { text })}>
          寝る前にやる
        </button>
      </div>
      {prep && !prep.doneAt && <span className="small muted">「{prep.text}」を寝る前にやる予定です。</span>}
    </div>
  );
}
