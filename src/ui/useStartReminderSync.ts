import { useEffect } from 'react';
import { useLive, useNow } from '../hooks';
import { db, getMeta } from '../lib/db';
import { addDays, lifeDate } from '../lib/lifeDate';
import { setStartReminders } from '../lib/push';
import { buildStartReminders, endReminderSettings, pushStartReminders, startReminderSettings } from '../lib/startReminders';

/** 予定の開始時刻の通知を、今日・明日の計画に合わせてサーバーへ送り直す（計画を動かす・済をつける・設定を変えるたび） */
export function useStartReminderSync() {
  const now = useNow();
  const today = lifeDate(now);
  const data = useLive(
    async () => ({
      plans: await db.plans.where('lifeDate').between(today, addDays(today, 1), true, true).toArray(),
      starts: await db.starts.where('lifeDate').between(addDays(today, -1), today, true, true).toArray(),
      meta: await getMeta(),
    }),
    [today],
  );
  const sig = data
    ? JSON.stringify(buildStartReminders(data.plans, today, startReminderSettings(data.meta), data.starts, Date.now(), !!data.meta.weekReminder, endReminderSettings(data.meta)))
    : null;
  useEffect(() => {
    if (sig === null) return;
    const id = window.setTimeout(() => void pushStartReminders(JSON.parse(sig), setStartReminders), 1500);
    return () => window.clearTimeout(id);
  }, [sig]);
}
