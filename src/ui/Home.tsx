import { useEffect } from 'react';
import { useLive, useNow } from '../hooks';
import { nowIso } from '../lib/clock';
import { db } from '../lib/db';
import { addDays, isEvening, lifeDate } from '../lib/lifeDate';
import { shelveExpired } from '../lib/leftovers';
import { MorningQuick } from './MorningQuick';
import { Today } from './Today';

// ホームの判定（§3.2）
export function Home({ onStartNight }: { onStartNight: () => void }) {
  const now = useNow();
  const today = lifeDate(now);
  const evening = isEvening(now);
  const data = useLive(
    async () => ({
      plan: await db.plans.get(today),
      tomorrow: await db.plans.get(addDays(today, 1)),
      plans: await db.plans.toArray(),
      tracks: await db.tracks.toArray(),
      steps: await db.steps.toArray(),
      leftovers: await db.leftovers.toArray(),
    }),
    [today],
  );

  // 3生活日を過ぎたやり残しを保留へ移す
  useEffect(() => {
    db.transaction('rw', db.leftovers, async () => {
      const moved = shelveExpired(await db.leftovers.toArray(), today, nowIso());
      if (moved.length) await db.leftovers.bulkPut(moved);
    });
  }, [today]);

  if (!data) return null;

  return (
    <>
      {evening && (
        <section className="night-entry" aria-label="夜の流れ">
          <span style={{ fontSize: 13, color: 'var(--on-strong-muted)' }}>
            {data.tomorrow ? '明日のルートは組み済みです。組み直すこともできます' : '答え合わせ → 1行ジャーナル → 明日を組む（3分）'}
          </span>
          <button className="btn-next" onClick={onStartNight}>
            {data.tomorrow ? '明日のルートを見直す' : '夜の流れを始める'}
          </button>
        </section>
      )}
      {data.plan ? (
        <Today plan={data.plan} today={today} tracks={data.tracks} steps={data.steps} plans={data.plans} />
      ) : (
        <MorningQuick today={today} tracks={data.tracks} steps={data.steps} leftovers={data.leftovers} plans={data.plans} />
      )}
    </>
  );
}
