// しおり Edge Function「push」：Web プッシュを送る（2026-11-08 追加。0005_web_push.sql・0007_start_reminders.sql とセット）
//
// 登録方法：README「9. 5分の知らせ」。Supabase ダッシュボード > Edge Functions で、
// 名前を push にしてこのファイルの中身を貼り付け、「Verify JWT」（JWT の検証）をオフにして公開する。
// 秘密値の登録は不要（VAPID の鍵は初回にこの関数が作り、push_config に入れる。service_role は Supabase が自動で渡す）。
//
// 受け付けるもの（POST、JSON）:
//   { "action": "public-key" } → { publicKey }  アプリが端末を登録するときに使う公開鍵
//   { "action": "dispatch" }   → 時刻が来た予定を送る。pg_cron（dispatch_due_pushes）から呼ばれる
// どちらも、誰が呼んでも害がない（公開鍵は公開してよいもの。dispatch は時刻が来たものしか送らない）

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

// 通知の文面。開始時刻の通知（start）だけは、本人が設定で決めた文面が予定ごとに届く（送ったらサーバーから消える）
const MESSAGES: Record<string, { title: string; body: string }> = {
  five_min: { title: 'しおり', body: '5分たちました。続けても、やめてもOK' },
  test: { title: 'しおり', body: 'テストの通知です。届いていれば準備できています' },
  start: { title: 'しおり', body: '次の行き先の時間です' },
};

// Apple の送信先に「誰が送っているか」を伝える連絡先（公開ページの URL）
const SUBJECT = 'https://yotteru.github.io/shiori/';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
type Db = any;

async function ensureKeys(db: Db): Promise<{ publicKey: string; privateKey: string }> {
  const read = async () => {
    const { data, error } = await db.from('push_config').select('vapid_public_key, vapid_private_key').eq('id', 1).single();
    if (error) throw error;
    return data as { vapid_public_key: string | null; vapid_private_key: string | null };
  };
  let row = await read();
  if (!row.vapid_public_key || !row.vapid_private_key) {
    const keys = webpush.generateVAPIDKeys();
    // 同時に呼ばれても片方だけが入るよう、空のときだけ書く
    await db
      .from('push_config')
      .update({ vapid_public_key: keys.publicKey, vapid_private_key: keys.privateKey })
      .eq('id', 1)
      .is('vapid_public_key', null);
    row = await read();
  }
  return { publicKey: row.vapid_public_key!, privateKey: row.vapid_private_key! };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { action } = await req.json().catch(() => ({ action: undefined }));

  try {
    const keys = await ensureKeys(db);
    if (action === 'public-key') return json({ publicKey: keys.publicKey });

    if (action === 'dispatch') {
      const { data, error } = await db.rpc('claim_due_pushes');
      if (error) throw error;
      const rows = (data ?? []) as { id: string; kind: string; endpoint: string; p256dh: string; auth: string; body: string | null }[];
      let sent = 0;
      for (const r of rows) {
        const base = MESSAGES[r.kind] ?? MESSAGES.test;
        const msg = r.kind === 'start' && r.body ? { ...base, body: r.body } : base;
        try {
          await webpush.sendNotification(
            { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
            JSON.stringify({ ...msg, tag: `shiori-${r.kind}-${r.id}` }),
            {
              vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
              TTL: 600, // 10分以内に届かなければ捨てる（遅れて来ても意味がない）
              urgency: 'high',
            },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // 404・410 = その端末の登録が切れた（アプリを入れ直したなど）。消して次から送らない
          if (status === 404 || status === 410) {
            await db.from('push_subscriptions').delete().eq('endpoint', r.endpoint);
          }
          console.error('push failed', status, (e as Error).message);
        }
      }
      return json({ sent, total: rows.length });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
