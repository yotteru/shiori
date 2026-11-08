-- migrations の動作確認（scripts/test-sql.sh から実行）。失敗すると例外で止まる
\set ON_ERROR_STOP on

-- 1. 生活日
do $$ begin
  assert public.life_date('2026-11-05 03:59:59+09') = '2026-11-04', 'JST 3:59 は前日';
  assert public.life_date('2026-11-05 04:00:00+09') = '2026-11-05', 'JST 4:00 は当日';
  assert public.life_date('2027-01-01 03:00:00+09') = '2026-12-31', '年末をまたぐ';
  assert public.life_date('2026-11-04 19:00:00+00') = '2026-11-05', 'UTC で渡しても JST で判定';
end $$;

-- 準備
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222')
  on conflict do nothing;
insert into vault.secrets_store values ('line_channel_access_token', 'dummy-token')
  on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;

-- 2. 通知の判定
do $$
declare n int;
begin
  delete from net.requests;
  delete from public.planning_pings;
  update public.notification_state set enabled = true, notify_time = '23:00', last_sent_life_date = null where id = 1;

  perform public.check_and_send_plan_reminder('2026-11-04 22:59+09');
  select count(*) into n from net.requests; assert n = 0, '22:59 は送らない';

  perform public.check_and_send_plan_reminder('2026-11-04 23:00+09');
  select count(*) into n from net.requests; assert n = 1, '23:00 に送る';
  assert (select last_sent_life_date from public.notification_state) = '2026-11-04', '送信後に生活日を記録';
  assert (select body->'messages'->0->>'text' from net.requests limit 1)
    = '明日のルートを組む時間です。ホーム画面の『しおり』から開いてください。', '文面';
  assert (select headers->>'Authorization' from net.requests limit 1) = 'Bearer dummy-token', 'Vault のトークンを使う';
  assert (select url from net.requests limit 1) = 'https://api.line.me/v2/bot/message/broadcast', 'broadcast に送る';

  perform public.check_and_send_plan_reminder('2026-11-04 23:05+09');
  select count(*) into n from net.requests; assert n = 1, '同じ生活日は2回送らない';

  -- 計画済みの日は送らない
  update public.notification_state set last_sent_life_date = null;
  insert into public.planning_pings (user_id, planned_for) values ('11111111-1111-1111-1111-111111111111', '2026-11-05');
  perform public.check_and_send_plan_reminder('2026-11-04 23:00+09');
  select count(*) into n from net.requests; assert n = 1, '明日を計画済みなら送らない';

  -- 時間外
  perform public.check_and_send_plan_reminder('2026-11-05 23:10+09');
  select count(*) into n from net.requests; assert n = 1, '23:10 は時間外';

  -- 無効
  update public.notification_state set enabled = false;
  perform public.check_and_send_plan_reminder('2026-11-05 23:00+09');
  select count(*) into n from net.requests; assert n = 1, '無効なら送らない';

  -- 日付をまたぐ通知時刻（23:55 → 0:02 は時間内）
  update public.notification_state set enabled = true, notify_time = '23:55', last_sent_life_date = null;
  perform public.check_and_send_plan_reminder('2026-11-06 00:02+09');
  select count(*) into n from net.requests; assert n = 2, '23:55 + 7分（0:02）は時間内';
  assert (select last_sent_life_date from public.notification_state) = '2026-11-05', '0:02 は前日の生活日';

  update public.notification_state set notify_time = '23:00', last_sent_life_date = null;
  delete from public.planning_pings;
  delete from net.requests;
end $$;

-- 3. RLS：本人の行だけ読み書きできる
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.planning_pings (user_id, planned_for) values ('11111111-1111-1111-1111-111111111111', '2026-11-05');
insert into public.encrypted_backups (user_id, ciphertext, iv, salt, schema_version)
  values ('11111111-1111-1111-1111-111111111111', 'x', 'y', 'z', 1);
do $$ begin
  begin
    insert into public.planning_pings (user_id, planned_for) values ('22222222-2222-2222-2222-222222222222', '2026-11-05');
    raise exception 'FAIL: 他人の行を書けてしまった';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.notification_state;
    raise exception 'FAIL: notification_state を読めてしまった';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.check_and_send_plan_reminder();
    raise exception 'FAIL: 判定関数を呼べてしまった';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.send_line_broadcast('x');
    raise exception 'FAIL: 送信関数を直接呼べてしまった';
  exception when insufficient_privilege then null;
  end;
end $$;
-- テスト送信は本人なら呼べる
select public.send_test_notification();

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.planning_pings) = 0, '他人の planning_pings は見えない';
  assert (select count(*) from public.encrypted_backups) = 0, '他人の encrypted_backups は見えない';
end $$;
reset role;

-- anon は何もできない
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  begin
    perform * from public.planning_pings;
    raise exception 'FAIL: anon が planning_pings を読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.encrypted_backups;
    raise exception 'FAIL: anon が encrypted_backups を読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.send_test_notification();
    raise exception 'FAIL: anon がテスト送信を呼べた';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  assert (select count(*) from net.requests) = 1, 'テスト送信は1件';
  assert (select body->'messages'->0->>'text' from net.requests) like '%（テスト）', 'テスト送信の文面';
  assert (select count(*) from cron.job where jobname = 'check-plan-reminder' and schedule = '*/10 * * * *') = 1, 'cron ジョブ';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and 'anon' = any(roles)), 'anon 向けポリシーがない';
end $$;

-- 4. 同期（0003）：後から変えた方だけ受け付け、本人の行しか読み書きできない
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare n int;
begin
  -- 新しい行
  select count(*) into n from public.push_records(
    '[{"kind":"track","record_id":"t1","ciphertext":"c1","iv":"i","deleted":false,"client_updated_at":"2026-11-07T10:00:00Z"}]'::jsonb);
  assert n = 0, '新しい行は受け付ける';
  -- 古い変更は受け付けず、サーバーの行を返す
  select count(*) into n from public.push_records(
    '[{"kind":"track","record_id":"t1","ciphertext":"old","iv":"i","deleted":false,"client_updated_at":"2026-11-07T09:00:00Z"}]'::jsonb);
  assert n = 1, '古い変更は返される';
  assert (select ciphertext from public.encrypted_records where record_id = 't1') = 'c1', '古い変更で上書きしない';
  -- 新しい変更は受け付ける（削除も）
  perform public.push_records(
    '[{"kind":"track","record_id":"t1","ciphertext":"c2","iv":"i","deleted":true,"client_updated_at":"2026-11-07T11:00:00Z"}]'::jsonb);
  assert (select deleted from public.encrypted_records where record_id = 't1'), '削除を受け付ける';
  -- 同じ時刻は上書き（合言葉を変えたときの送り直し）
  perform public.push_records(
    '[{"kind":"track","record_id":"t1","ciphertext":"c3","iv":"i","deleted":true,"client_updated_at":"2026-11-07T11:00:00Z"}]'::jsonb);
  assert (select ciphertext from public.encrypted_records where record_id = 't1') = 'c3', '同じ時刻は上書き';
  -- 種類の制限
  begin
    perform public.push_records('[{"kind":"meta","record_id":"x","ciphertext":"c","iv":"i","client_updated_at":"2026-11-07T11:00:00Z"}]'::jsonb);
    raise exception 'FAIL: 決められていない種類を受け付けた';
  exception when check_violation then null;
  end;
  -- いつもの固定（0004 で追加）
  perform public.push_records('[{"kind":"routine","record_id":"r1","ciphertext":"c","iv":"i","client_updated_at":"2026-11-08T10:00:00Z"}]'::jsonb);
  assert exists (select 1 from public.encrypted_records where kind = 'routine'), 'routine を受け付ける';
  insert into public.sync_keys (salt, check_ciphertext, check_iv) values ('s', 'c', 'i');
end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.encrypted_records) = 0, '他人の encrypted_records は見えない';
  assert (select count(*) from public.sync_keys) = 0, '他人の sync_keys は見えない';
  -- 他人と同じ record_id でも別の行になる
  perform public.push_records(
    '[{"kind":"track","record_id":"t1","ciphertext":"other","iv":"i","deleted":false,"client_updated_at":"2020-01-01T00:00:00Z"}]'::jsonb);
  begin
    insert into public.encrypted_records (user_id, kind, record_id, ciphertext, iv, client_updated_at)
      values ('11111111-1111-1111-1111-111111111111', 'track', 'x', 'c', 'i', now());
    raise exception 'FAIL: 他人の行を書けてしまった';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role anon;
reset request.jwt.claim.sub;
do $$ begin
  begin
    perform public.push_records('[]'::jsonb);
    raise exception 'FAIL: anon が push_records を呼べた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.sync_keys;
    raise exception 'FAIL: anon が sync_keys を読めた';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  assert (select ciphertext from public.encrypted_records where user_id = '11111111-1111-1111-1111-111111111111' and record_id = 't1') = 'c3',
    '他人の送信で本人の行は変わらない';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and 'anon' = any(roles)), 'anon 向けポリシーがない';
end $$;

-- 6. Web プッシュ（0005）
delete from net.requests;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare pid uuid; pid2 uuid;
begin
  begin
    perform public.register_push_subscription('https://web.push.apple.com/abc', 'k', 'a', 'https://evil.example.com/x');
    raise exception 'FAIL: おかしな URL を受け付けた';
  exception when invalid_parameter_value then null;
  end;
  perform public.register_push_subscription('https://web.push.apple.com/abc', 'k', 'a', 'https://xyz.supabase.co/functions/v1/push');
  perform public.register_push_subscription('https://web.push.apple.com/abc', 'k2', 'a2', 'https://xyz.supabase.co/functions/v1/push');
  assert (select count(*) from public.push_subscriptions) = 1, '同じ端末は1行';
  assert (select p256dh from public.push_subscriptions) = 'k2', '登録し直すと鍵を更新';

  begin
    perform public.schedule_push('https://web.push.apple.com/abc', 'five_min', 5);
    raise exception 'FAIL: 5秒後を受け付けた';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.schedule_push('https://web.push.apple.com/other', 'five_min', 300);
    raise exception 'FAIL: 登録していない端末に予定を入れられた';
  exception when invalid_parameter_value then null;
  end;
  pid := public.schedule_push('https://web.push.apple.com/abc', 'five_min', 300);
  pid2 := public.schedule_push('https://web.push.apple.com/abc', 'test', 60);
  perform public.cancel_push(pid2);
  assert (select count(*) from public.push_schedules) = 2, '本人の予定は読める';
  begin
    perform * from public.push_config;
    raise exception 'FAIL: 本人でも push_config を読めた';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.claim_due_pushes();
    raise exception 'FAIL: 本人が claim_due_pushes を呼べた';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 0, '他人の端末は見えない';
  assert (select count(*) from public.push_schedules) = 0, '他人の予定は見えない';
  perform public.cancel_push((select id from public.push_schedules limit 1));
end $$;
reset role;

do $$
declare n int; sid uuid;
begin
  select id into sid from public.push_schedules where kind = 'five_min';
  assert (select function_url from public.push_config) = 'https://xyz.supabase.co/functions/v1/push', 'URL を覚える';

  perform public.dispatch_due_pushes(now() + interval '4 minutes');
  select count(*) into n from net.requests; assert n = 0, '時刻前は呼ばない';
  perform public.dispatch_due_pushes(now() + interval '5 minutes 30 seconds');
  select count(*) into n from net.requests; assert n = 1, '時刻が来たら Edge Function を1回呼ぶ';
  assert (select url from net.requests limit 1) = 'https://xyz.supabase.co/functions/v1/push', '覚えた URL に送る';

  assert (select count(*) from public.claim_due_pushes(now() + interval '5 minutes 30 seconds')) = 1, '取り消していない1件だけ';
  assert (select sent_at is not null from public.push_schedules where id = sid), '送ったにする';
  assert (select count(*) from public.claim_due_pushes(now() + interval '6 minutes')) = 0, '2回は送らない';

  delete from net.requests;
  perform public.dispatch_due_pushes(now() + interval '6 minutes');
  select count(*) into n from net.requests; assert n = 0, '送るものがなければ呼ばない';

  insert into public.push_schedules (user_id, endpoint, kind, send_at)
    values ('11111111-1111-1111-1111-111111111111', 'https://web.push.apple.com/abc', 'test', now() - interval '1 hour');
  assert (select count(*) from public.claim_due_pushes()) = 0, '30分以上前の予定は送らない';

  update public.push_schedules set created_at = now() - interval '8 days';
  perform public.cleanup_pushes();
  assert (select count(*) from public.push_schedules) = 0, '古い予定を消す';
end $$;

set role anon;
reset request.jwt.claim.sub;
do $$ begin
  begin
    perform public.schedule_push('https://web.push.apple.com/abc', 'five_min', 300);
    raise exception 'FAIL: anon が schedule_push を呼べた';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 7. 開始時刻の通知（0007）
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare n int;
begin
  n := public.set_start_reminders('https://web.push.apple.com/abc', jsonb_build_array(
    jsonb_build_object('send_at', now() + interval '10 minutes', 'body', 'アドイン の時間です'),
    jsonb_build_object('send_at', now() + interval '1 hour', 'body', ''),
    jsonb_build_object('send_at', now() - interval '1 minute', 'body', '過去'),
    jsonb_build_object('send_at', now() + interval '3 days', 'body', '先すぎる')
  ));
  assert n = 2, '過去と2日より先は捨てる';
  n := public.set_start_reminders('https://web.push.apple.com/abc', jsonb_build_array(
    jsonb_build_object('send_at', now() + interval '20 minutes', 'body', '置き換え後')
  ));
  assert n = 1;
  assert (select count(*) from public.push_schedules where kind = 'start') = 1, '丸ごと置き換える';
  begin
    perform public.set_start_reminders('https://web.push.apple.com/other', '[]'::jsonb);
    raise exception 'FAIL: 登録していない端末に入れられた';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

do $$
declare r record;
begin
  select * into r from public.claim_due_pushes(now() + interval '21 minutes') where kind = 'start';
  assert r.body = '置き換え後', '文面を返す';
  assert (select body from public.push_schedules where id = r.id) is null, '送ったら文面を消す';
  assert (select sent_at is not null from public.push_schedules where id = r.id), '送ったにする';
end $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.set_start_reminders('https://web.push.apple.com/abc', '[]'::jsonb);
  assert (select count(*) from public.push_schedules where kind = 'start' and sent_at is not null) = 1, '送ったものは消さない';
end $$;
reset role;

select 'ALL SQL TESTS PASSED';
