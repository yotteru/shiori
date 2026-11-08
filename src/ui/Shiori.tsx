import { useEffect, useState } from 'react';
import { useLive, useNow } from '../hooks';
import type { SavePlanResult } from '../lib/actions';
import { nowIso } from '../lib/clock';
import { db } from '../lib/db';
import { shelveExpired } from '../lib/leftovers';
import { addDays, lifeDate } from '../lib/lifeDate';
import type { Plan } from '../lib/types';
import { NightFinishedExtras } from './Backup';
import { PlanBuilder } from './PlanBuilder';
import { JournalCard, ReviewCard } from './Reflection';
import { Today } from './Today';

// しおりタブ（2026-11-08 見直し）。
// 時間帯で中身を切り替えず、「今日」「明日」を本人がいつでも切り替えられる

type Day = 'today' | 'tomorrow';

export function Shiori() {
  const [day, setDay] = useState<Day>('today');
  const now = useNow();
  const today = lifeDate(now);

  // 3生活日を過ぎたやり残しを保留へ移す
  useEffect(() => {
    db.transaction('rw', db.leftovers, async () => {
      const moved = shelveExpired(await db.leftovers.toArray(), today, nowIso());
      if (moved.length) await db.leftovers.bulkPut(moved);
    });
  }, [today]);

  return (
    <>
      <div className="seg" role="tablist" aria-label="今日と明日">
        <button role="tab" aria-selected={day === 'today'} aria-pressed={day === 'today'} onClick={() => setDay('today')}>
          今日
        </button>
        <button role="tab" aria-selected={day === 'tomorrow'} aria-pressed={day === 'tomorrow'} onClick={() => setDay('tomorrow')}>
          明日
        </button>
      </div>
      {day === 'today' ? <TodayView key={today} today={today} /> : <TomorrowView key={today} today={today} />}
    </>
  );
}

function useDayData(today: string) {
  return useLive(
    async () => ({
      plan: await db.plans.get(today),
      yesterday: await db.plans.get(addDays(today, -1)),
      tomorrow: await db.plans.get(addDays(today, 1)),
      journal: await db.journals.get(today),
      plans: await db.plans.toArray(),
      tracks: await db.tracks.toArray(),
      steps: await db.steps.toArray(),
      leftovers: await db.leftovers.toArray(),
    }),
    [today],
  );
}

const reviewKey = (p: Plan) => p.items.map((i) => `${i.id}:${i.status}`).join(',');

function TodayView({ today }: { today: string }) {
  const data = useDayData(today);
  const [editing, setEditing] = useState(false);
  if (!data) return null;

  const pendingYesterday = data.yesterday?.items.some((i) => i.status === 'planned') ? data.yesterday : undefined;

  return (
    <>
      {pendingYesterday && (
        <ReviewCard
          key={`y-${reviewKey(pendingYesterday)}`}
          plan={pendingYesterday}
          title="昨日の答え合わせが残っています"
          note="昨日の行き先を済か未に決めてください。未にしたものは、今日の候補の先頭に並びます。"
        />
      )}

      {editing || !data.plan ? (
        <PlanBuilder
          today={today}
          planFor={today}
          tracks={data.tracks}
          steps={data.steps}
          leftovers={data.leftovers}
          plans={data.plans}
          resumeOrder
          title={data.plan ? '今日のしおりを組み直す' : '今日のルートを組む'}
          intro={data.plan ? '行き先を足したり、並べ替えたりできます。' : '前の晩に組んでいなければ、ここで今日の分を組めます。'}
          defaultSource="morning-quick"
          saveLabel={data.plan ? 'この内容にする' : 'この計画で今日をはじめる'}
          onSaved={() => setEditing(false)}
          onCancel={data.plan ? () => setEditing(false) : undefined}
        />
      ) : (
        <>
          <Today plan={data.plan} today={today} tracks={data.tracks} steps={data.steps} plans={data.plans} />
          <button className="btn" onClick={() => setEditing(true)}>
            行き先を足す・並べ替える
          </button>
          <ReviewCard key={`t-${reviewKey(data.plan)}`} plan={data.plan} title="今日の答え合わせ" collapsed />
        </>
      )}

      <JournalCard key={today} lifeDate={today} saved={data.journal?.text ?? ''} />
    </>
  );
}

function TomorrowView({ today }: { today: string }) {
  const data = useDayData(today);
  const [saved, setSaved] = useState<{ plan: Plan; result: SavePlanResult } | null>(null);
  if (!data) return null;
  const planFor = addDays(today, 1);

  if (saved) {
    const first = saved.plan.items[0];
    return (
      <>
        <div className="head">
          <span className="sub">保存しました</span>
          <h1 className="title">明日のルートができました</h1>
        </div>
        {first && (
          <section className="next-card">
            <span className="kicker">明日の最初の行き先</span>
            <span className="t">{first.title}</span>
            {first.firstStep && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="cap">最初の一手</span>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{first.firstStep}</span>
              </div>
            )}
          </section>
        )}
        <NightFinishedExtras />
        {saved.result.ping === 'failed' && (
          <p className="small muted" style={{ margin: 0 }}>
            計画した日付をサーバーに送れませんでした。次回の保存時にもう一度送ります。
          </p>
        )}
        {saved.result.backup === 'failed' && (
          <p className="small muted" style={{ margin: 0 }}>
            自動バックアップに失敗しました。次回の保存時にもう一度行います。
          </p>
        )}
        <button className="btn" onClick={() => setSaved(null)}>
          もう一度直す
        </button>
      </>
    );
  }

  return (
    <PlanBuilder
      today={today}
      planFor={planFor}
      tracks={data.tracks}
      steps={data.steps}
      leftovers={data.leftovers}
      plans={data.plans}
      title={data.tomorrow ? '明日のルート（保存済み・直せます）' : '明日のルートを組む'}
      defaultSource="night"
      saveLabel="この計画で明日を迎える"
      onSaved={(plan, result) => setSaved({ plan, result })}
    />
  );
}
