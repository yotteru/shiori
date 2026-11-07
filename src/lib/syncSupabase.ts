import { supabase } from './supabase';
import type { OutgoingRow, RemoteRow, SyncKeys, SyncServer } from './syncEngine';

// 本番のサーバー（Supabase）。テーブルは supabase/migrations/0003_sync.sql
export function supabaseSyncServer(): SyncServer | null {
  const sb = supabase;
  if (!sb) return null;
  const fail = (what: string) => new Error(`同期の${what}に失敗しました`);
  return {
    async getKeys() {
      const { data, error } = await sb.from('sync_keys').select('salt, check_ciphertext, check_iv').maybeSingle();
      if (error) throw fail('準備');
      return (data as SyncKeys | null) ?? null;
    },
    async putKeys(k: SyncKeys) {
      const { data: s } = await sb.auth.getSession();
      const userId = s.session?.user.id;
      if (!userId) throw fail('準備');
      const { error } = await sb.from('sync_keys').upsert({ user_id: userId, ...k, updated_at: new Date().toISOString() });
      if (error) throw fail('準備');
    },
    async push(rows: OutgoingRow[]) {
      if (!rows.length) return [];
      const { data, error } = await sb.rpc('push_records', { records: rows });
      if (error) throw fail('送信');
      return (data as RemoteRow[] | null) ?? [];
    },
    async pull(since: string | null, limit: number) {
      let q = sb
        .from('encrypted_records')
        .select('kind, record_id, ciphertext, iv, deleted, client_updated_at, server_updated_at')
        .order('server_updated_at', { ascending: true })
        .limit(limit);
      if (since) q = q.gt('server_updated_at', since);
      const { data, error } = await q;
      if (error) throw fail('取り込み');
      return (data as RemoteRow[] | null) ?? [];
    },
  };
}
