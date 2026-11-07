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

select 'ALL SQL TESTS PASSED';
