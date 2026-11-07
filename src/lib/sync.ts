import { db, getMeta, updateMeta, type ShioriDB } from './db';
import { currentUserId, supabase } from './supabase';

// Supabase への送信。失敗しても端末内の保存には影響させない（指示書 §3.4）

export type SyncResult = 'ok' | 'failed' | 'skipped';

/** 「計画した日付」を送る。送れなかった日付は Meta.pendingPings に残し、次回まとめて再送する */
export async function pushPlanningPing(plannedFor: string, database: ShioriDB = db): Promise<SyncResult> {
  const meta = await getMeta(database);
  const dates = Array.from(new Set([...(meta.pendingPings ?? []), plannedFor])).sort();
  const userId = supabase ? await currentUserId() : null;
  if (!supabase || !userId) {
    await updateMeta({ pendingPings: dates }, database);
    return supabase ? 'failed' : 'skipped';
  }
  try {
    const { error } = await supabase
      .from('planning_pings')
      .upsert(
        dates.map((d) => ({ user_id: userId, planned_for: d })),
        { onConflict: 'user_id,planned_for', ignoreDuplicates: true },
      );
    if (error) throw new Error(error.code ?? 'upsert failed');
    await updateMeta({ pendingPings: undefined }, database);
    return 'ok';
  } catch {
    await updateMeta({ pendingPings: dates }, database);
    return 'failed';
  }
}
