import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  weeklyDoneMinutes,
  type Gap,
} from '../lib/calendar';
import {
  addExtraFixed,
  confirmPlan,
  editFirstStep,
  moveExtraFixed,
  moveItem,
  placeCandidate,
  removeExtraFixed,
  removeItem,
  setFixedEdit,
  setHoliday,
} from '../lib/calendarActions';
import { buildCandidates, candidateKey, lastDoneByTrack, morningCandidates, type Candidate } from '../lib/candidates';
import { nowIso, toDate } from '../lib/clock';
import { db, getMeta } from '../lib/db';
import { shelveExpired } from '../lib/leftovers';
import { addDays, formatLifeDateJa, jstTime, lifeDate, minutesIntoLifeDay, weekday } from '../lib/lifeDate';
import type { Plan, PlanItem } from '../lib/types';
import { NightFinishedExtras } from './Backup';
import { Calendar, PX_PER_MIN, type CalBlock } from './Calendar';
import { MinutesSelect, Sheet, TimeSelect, Toast } from './common';
import { DoneSheet } from './DoneSheet';
import { JournalCard, ReviewCard } from './Reflection';

// しおりタブ（2026-11-08 カレンダー版）。「今日」「明日」をいつでも切り替えて、縦のカレンダーで組む

type Day = 'today' | 'tomorrow';
type SheetKind = null | 'fixed' | 'reflect' | 'yesterday' | 'first' | 'confirmed';
const TAB_H = 56;

export function DayView() {
  const now = useNow();
  const today = lifeDate(now);
  const [day, setDay] = useState<Day>('today');
  const date = day === 'today' ? today : addDays(today, 1);
  const source: Plan['source'] = day === 'today' ? 'morning-quick' : 'night';

  const data = useLive(
    async () => ({
      plan: await db.plans.get(date),
      yesterday: await db.plans.get(addDays(today, -1)),
      journal: await db.journals.get(today),
      plans: await db.plans.toArray(),
      tracks: await db.tracks.toArray(),
      steps: await db.steps.toArray(),
      leftovers: await db.leftovers.toArray(),
      routines: await db.routines.toArray(),
      view: (await getMeta()).calendarView ?? DEFAULT_VIEW,
      started: await db.drafts.where('key').startsWith(`started:${today}:`).toArray(),
    }),
    [date, today],
  );

  const [sel, setSel] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [doneFor, setDoneFor] = useState<PlanItem | null>(null);
  const [toast, setToast] = useState<{ message: string; undoId?: string } | null>(null);
  const [confirmed, setConfirmed] = useState<SavePlanResult | null>(null);
  const [topH, setTopH] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // 3生活日を過ぎたやり残しを保留へ移す
  useEffect(() => {
    db.transaction('rw', db.leftovers, async () => {
      const moved = shelveExpired(await db.leftovers.toArray(), today, nowIso());
      if (moved.length) await db.leftovers.bulkPut(moved);
    });
  }, [today]);

  // 見出しは画面の上に重ねて固定。その高さぶん、ページの上を空けておく
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    setTopH(el.offsetHeight);
  });


  const view = data?.view ?? DEFAULT_VIEW;
  const nowMin = minutesIntoLifeDay(now) + 4 * 60;

  const scrollToMinute = (m: number, smooth = false) => {
    const grid = document.querySelector('.cal-grid');
    if (!grid) return;
    const y = grid.getBoundingClientRect().top + window.scrollY + (m - view.start * 60) * PX_PER_MIN - (topRef.current?.offsetHeight ?? 0) - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  };

  // 開いたとき・今日と明日を切り替えたとき：今日は「いま」の少し前、明日は設定の位置へ
  const loaded = !!data;
  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => scrollToMinute(day === 'today' ? nowMin - 90 : view.focus * 60), 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, loaded]);

  if (!data) return null;

  const plan = data.plan;
  const items = plan ? itemsByStart(plan) : [];
  const next = day === 'today' && plan ? nextItem(plan) : undefined;
  const fixed = fixedBlocksFor(date, data.routines, plan);
  const trackById = new Map(data.tracks.map((t) => [t.id, t]));

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
      first: i.firstStep,
    })),
  ];
  // 今日は「いま」より後だけ。明日は表示する時間帯の全体
  const gaps = findGaps(blocks, { from: day === 'today' ? Math.max(view.start * 60, Math.ceil((nowMin + 1) / 15) * 15) : view.start * 60, to: view.end * 60 });

  // 候補（今日は前回の続きが新しい順）
  const all = buildCandidates({ today, tracks: data.tracks, steps: data.steps, leftovers: data.leftovers });
  const cands = day === 'today' ? morningCandidates(all, data.tracks, lastDoneByTrack(data.plans, data.steps), all.length) : all;
  const placedKeys = new Set(items.map((i) => candidateKey(i.trackId, i.stepId)));
  const heldCand = cands.find((c) => c.key === held);

  const weekly = weeklyDoneMinutes(data.plans, today);
  const activeTracks = data.tracks.filter((t) => !t.archivedAt);
  const pendingYesterday = data.yesterday?.items.some((i) => i.status === 'planned') ? data.yesterday : undefined;
  const started = next ? data.started.find((s) => s.key === `started:${today}:${next.id}`) : undefined;

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
          ? started
            ? `${jstTime(toDate(started.value))} に始めました`
            : next
              ? '黒い予定が次の行き先'
              : '空きをタップするか、候補を持って時刻をタップして今日を組む'
          : '「空き」をタップして埋める。候補を持って時刻をタップでもOK';

  const bottomInset = () => (dockRef.current?.offsetHeight ?? 0) + TAB_H;

  return (
    <>
      <div ref={topRef} className="cal-top">
        <div className="seg" role="tablist" aria-label="今日と明日">
          {(['today', 'tomorrow'] as const).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={day === d}
              aria-pressed={day === d}
              onClick={() => {
                setDay(d);
                setSel(null);
                setHeld(null);
                setGap(null);
              }}
            >
              {d === 'today' ? '今日' : '明日'}
            </button>
          ))}
        </div>
        <div className="cal-title">
          <h1>
            {formatLifeDateJa(date)}
            {day === 'today' ? ' 今日' : ' 明日'}
          </h1>
          <div className="cal-chips">
            {day === 'today' && pendingYesterday && (
              <button className="chip-btn accent" onClick={() => setSheet('yesterday')}>
                昨日の答え合わせ
              </button>
            )}
            {day === 'today' ? (
              <>
                <button className="chip-btn accent" onClick={() => scrollToMinute(nowMin - 60, true)}>
                  いま
                </button>
                <button className="chip-btn" onClick={() => setSheet('reflect')}>
                  振り返り
                </button>
              </>
            ) : (
              <button className="chip-btn" onClick={() => scrollToMinute(view.focus * 60, true)}>
                {view.focus}時へ
              </button>
            )}
          </div>
        </div>
        {/* 見出し（今週の合計・候補・案内）はスクロールしても畳まず、常に表示する（2026-11-08） */}
        <div className="cal-collapse">
          <div className="row-scroll">
            <span className="week-chip muted" style={{ paddingLeft: 0 }}>
              今週（済）
            </span>
            {activeTracks.map((t) => (
              <span key={t.id} className="week-chip" style={{ background: t.type === 'habit' ? '#e3f2f0' : '#fdebdf' }}>
                <b>{t.name}</b> <span className="mono">{formatDuration(weekly[t.id] ?? 0)}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="row-scroll">
            {cands.length === 0 && <span className="small muted">候補がありません。「取り組み」から追加できます。</span>}
            {cands.map((c) => {
              const placed = placedKeys.has(c.key) && c.trackType === 'project';
              const fit = gap ? Math.max(30, c.minutes) <= gap.len : null;
              const cls = ['tray-cand', held === c.key ? 'held' : '', placed ? 'placed' : '', fit === true ? 'fit' : fit === false ? 'nofit' : ''].join(' ');
              return (
                <button
                  key={c.key}
                  className={cls}
                  disabled={placed}
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
                    {c.kind === 'leftover' ? 'やり残し' : c.trackName}・{Math.max(30, c.minutes)}分
                  </small>
                  <span>{c.title}</span>
                </button>
              );
            })}
        </div>
        <div className={`cal-hint${gap || heldCand ? ' on' : ''}`}>{hint}</div>
        <div className="cal-lanes">
          <button onClick={() => setSheet('fixed')}>固定 ▾</button>
          <span>取り組み</span>
        </div>
      </div>
      {/* .screen の上の余白（20px＋安全領域）と間隔（16px）を差し引いて、見出しの下から始まるようにする */}
      <div style={{ height: `max(0px, calc(${topH}px - 36px - env(safe-area-inset-top)))`, marginTop: -16 }} aria-hidden="true" />

      <Calendar
        view={view}
        blocks={blocks}
        gaps={gaps}
        selectedId={sel}
        holding={!!heldCand}
        gapStart={gap?.start ?? null}
        now={day === 'today' ? nowMin : undefined}
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
        topInset={() => topRef.current?.getBoundingClientRect().bottom ?? 0}
        bottomInset={bottomInset}
      />
      <div style={{ height: 120 }} aria-hidden="true" />

      <nav className="cal-index" aria-label="時刻へ移動">
        {Array.from({ length: Math.ceil((view.end - view.start) / 2) }, (_, k) => view.start + k * 2).map((h) => (
          <button key={h} onClick={() => scrollToMinute(h * 60, true)}>
            {h >= 24 ? h - 24 : h}
          </button>
        ))}
      </nav>

      <div ref={dockRef} className="cal-dock">
        {selected ? (
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
                  <button className="link" onClick={() => setSheet('first')}>
                    最初の一手：{selItem.firstStep || '（タップして書く）'}
                  </button>
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
        ) : day === 'today' ? (
          next ? (
            <div className="cal-two">
              <button
                className="btn-next"
                onClick={() => db.drafts.put({ key: `started:${today}:${next.id}`, value: nowIso(), updatedAt: nowIso() })}
              >
                最初の一手を始める
              </button>
              <button className="btn" style={{ fontWeight: 700 }} onClick={() => setDoneFor(next)}>
                済をつける
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setSheet('reflect')}>
              今日の振り返り（答え合わせ・ジャーナル）
            </button>
          )
        ) : (
          <button
            className="btn-primary"
            disabled={!plan || plan.items.length === 0}
            onClick={async () => {
              setConfirmed(await confirmPlan(date));
              setSheet('confirmed');
            }}
          >
            この計画で明日を迎える
          </button>
        )}
      </div>

      {sheet === 'fixed' && <FixedSheet date={date} plan={plan} routines={data.routines} source={source} onClose={() => setSheet(null)} />}
      {sheet === 'reflect' && (
        <Sheet onClose={() => setSheet(null)} label="今日の振り返り">
          <span style={{ fontSize: 16, fontWeight: 700 }}>今日の振り返り</span>
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
      {sheet === 'yesterday' && pendingYesterday && (
        <Sheet onClose={() => setSheet(null)} label="昨日の答え合わせ">
          <ReviewCard
            plan={pendingYesterday}
            title="昨日の答え合わせが残っています"
            note="昨日の行き先を済か未に決めてください。未にしたものは、今日の候補の先頭に並びます。"
          />
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
            await editFirstStep(date, selItem.id, v.trim());
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
          <NightFinishedExtras />
          {confirmed.ping === 'failed' && <p className="small muted">計画した日付をサーバーに送れませんでした。次回もう一度送ります。</p>}
          {confirmed.backup === 'failed' && <p className="small muted">自動バックアップに失敗しました。次回もう一度行います。</p>}
          <button className="btn-primary" onClick={() => setSheet(null)}>
            閉じる
          </button>
        </Sheet>
      )}
      {doneFor && (
        <DoneSheet
          item={doneFor}
          lifeDate={date}
          onClose={() => setDoneFor(null)}
          onDone={() => {
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

function FirstStepSheet({ initial, title, onSave, onClose }: { initial: string; title: string; onSave: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <Sheet onClose={onClose} label="最初の一手">
      <span className="sub">{title}</span>
      <label className="field">
        <span>最初の一手</span>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="例：バッグを持って家を出る" />
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

/** その日の固定：いつもの固定を外す・戻す、この日だけの予定を足す、休日として扱う */
function FixedSheet({
  date,
  plan,
  routines,
  source,
  onClose,
}: {
  date: string;
  plan?: Plan;
  routines: import('../lib/types').Routine[];
  source: Plan['source'];
  onClose: () => void;
}) {
  const wd = plan?.holiday ? 0 : weekday(date);
  const edits = plan?.fixedEdits ?? {};
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('10:00');
  const [min, setMin] = useState(60);
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
  return (
    <Sheet onClose={onClose} label="この日の固定">
      <span style={{ fontSize: 16, fontWeight: 700 }}>{formatLifeDateJa(date)}の固定</span>
      {routines.filter((r) => r.days.includes(wd)).length === 0 && (
        <p className="sub" style={{ margin: 0 }}>
          この曜日のいつもの固定はありません。設定タブの「いつもの固定」で決められます。
        </p>
      )}
      {routines
        .filter((r) => r.days.includes(wd))
        .map((r) => {
          const e = edits[r.id];
          const removed = e === 'removed';
          const moved = e && e !== 'removed' ? e : null;
          return (
            <div key={r.id} className="card-tight row" style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: removed ? 0.7 : 1 }}>
              <div className="stack" style={{ gap: 0 }}>
                <b>{r.title}</b>
                <span className="small muted mono">
                  {formatMinute(moved ? moved.start : r.start)}–{formatMinute((moved ? moved.start : r.start) + (moved ? moved.min : r.min))}・
                  {removed ? 'この日は外している' : moved ? 'この日だけ時間を変えている' : 'いつもどおり'}
                </span>
              </div>
              <button className="btn" style={{ minHeight: 36 }} onClick={() => setFixedEdit(date, r.id, removed || moved ? undefined : 'removed', source)}>
                {removed ? '戻す' : moved ? 'いつもに戻す' : '外す'}
              </button>
            </div>
          );
        })}
      {(plan?.extraFixed ?? []).map((x) => (
        <div key={x.id} className="card-tight row" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <div className="stack" style={{ gap: 0 }}>
            <b>{x.title}</b>
            <span className="small muted mono">
              {formatMinute(x.start)}–{formatMinute(x.start + x.min)}・この日だけ
            </span>
          </div>
          <button className="btn" style={{ minHeight: 36 }} onClick={() => removeExtraFixed(date, x.id)}>
            消す
          </button>
        </div>
      ))}
      <div className="card" style={{ gap: 8 }}>
        <span className="label">この日だけの予定を足す</span>
        <input className="input" value={title} placeholder="例：歯医者" onChange={(e) => setTitle(e.target.value)} />
        <div className="row">
          <TimeSelect label="開始" value={start} onChange={setStart} />
          <MinutesSelect value={min} onChange={setMin} />
        </div>
        <button
          className="btn"
          disabled={!title.trim()}
          onClick={async () => {
            await addExtraFixed(date, title.trim(), toMin(start), min, source);
            setTitle('');
          }}
        >
          足す
        </button>
      </div>
      <button className="btn" onClick={() => setHoliday(date, !plan?.holiday, source)}>
        {plan?.holiday ? 'この日を平日に戻す' : 'この日は休日として扱う（祝日・有休）'}
      </button>
      <button className="btn-primary" onClick={onClose}>
        閉じる
      </button>
    </Sheet>
  );
}
