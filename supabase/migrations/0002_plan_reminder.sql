-- ============================================================================
-- しおり 0002：夜23時の LINE 通知（pg_cron → pg_net → LINE Messaging API broadcast）
--
-- 事前準備（README「初期設定」参照）:
--   Supabase ダッシュボード > Vault（Project Settings > Vault）で、
--   name = line_channel_access_token としてチャネルアクセストークンを登録しておく。
--   トークンはこのファイル・Git・チャットに書かないこと。
--
-- 実行方法:
--   0001 を実行した後、Supabase ダッシュボード > SQL Editor でこのファイルを実行する。
--   何度実行しても安全（関数は上書き、cron ジョブは登録し直す）。
--
-- 実行後の確認:
--   select jobname, schedule, command from cron.job;
--   → check-plan-reminder が */10 * * * * で登録されていること
--   通知時刻を変える（例：試しに数分後にする）:
--   update public.notification_state set notify_time = '21:30', last_sent_life_date = null where id = 1;
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions; -- public に入れない

-- 通知の文面（固定）
create or replace function public.plan_reminder_text()
returns text
language sql
immutable
set search_path = ''
as $$
  select '明日のルートを組む時間です。ホーム画面の『しおり』から開いてください。'::text;
$$;

-- LINE へ broadcast する（内部用。クライアントからは直接呼べない）
create or replace function public.send_line_broadcast(message text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  request_id bigint;
begin
  select decrypted_secret into token
    from vault.decrypted_secrets
   where name = 'line_channel_access_token'
   limit 1;
  if token is null or token = '' then
    raise exception 'Vault に line_channel_access_token が登録されていません';
  end if;

  select net.http_post(
    url := 'https://api.line.me/v2/bot/message/broadcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    body := jsonb_build_object(
      'messages', jsonb_build_array(jsonb_build_object('type', 'text', 'text', message))
    )
  ) into request_id;
  return request_id;
end;
$$;

-- 10分おきに実行。すべて満たしたときだけ送る（指示書 §5.2）
--   1. enabled = true
--   2. JST の現在時刻が notify_time 以上、notify_time + 10分 未満（日付またぎも考慮）
--   3. last_sent_life_date が今日の生活日ではない
--   4. 明日の生活日の planning_pings が存在しない（もう計画済みなら送らない）
-- 引数 at はテスト用（cron からは引数なしで呼ぶ = 現在時刻）
drop function if exists public.check_and_send_plan_reminder();
create or replace function public.check_and_send_plan_reminder(at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.notification_state%rowtype;
  now_ts timestamptz := at;
  today date := public.life_date(now_ts);
  since_notify interval;
begin
  select * into st from public.notification_state where id = 1;
  if not found or not st.enabled then
    return;
  end if;

  -- notify_time からの経過（0〜24時間に正規化）。10分未満なら時間内
  since_notify := (now_ts at time zone 'Asia/Tokyo')::time - st.notify_time;
  if since_notify < interval '0' then
    since_notify := since_notify + interval '24 hours';
  end if;
  if since_notify >= interval '10 minutes' then
    return;
  end if;

  if st.last_sent_life_date is not distinct from today then
    return; -- 今日の生活日はもう送った
  end if;

  if exists (select 1 from public.planning_pings where planned_for = today + 1) then
    return; -- 明日はもう計画済み
  end if;

  perform public.send_line_broadcast(public.plan_reminder_text());
  update public.notification_state set last_sent_life_date = today where id = 1;
end;
$$;

-- テスト送信：ログイン中の本人だけが RPC で呼べる。判定を飛ばして「（テスト）」付きで送る
create or replace function public.send_test_notification()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;
  perform public.send_line_broadcast(public.plan_reminder_text() || '（テスト）');
end;
$$;

-- 実行権限：内部用の関数は誰にも渡さない。テスト送信だけログイン済みに許可
revoke all on function public.send_line_broadcast(text) from public, anon, authenticated;
revoke all on function public.check_and_send_plan_reminder(timestamptz) from public, anon, authenticated;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- cron ジョブを登録し直す
do $$
begin
  if exists (select 1 from cron.job where jobname = 'check-plan-reminder') then
    perform cron.unschedule('check-plan-reminder');
  end if;
end $$;

select cron.schedule(
  'check-plan-reminder',
  '*/10 * * * *',
  $$select public.check_and_send_plan_reminder();$$
);
