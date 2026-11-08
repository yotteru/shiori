-- ============================================================================
-- しおり 0005：Web プッシュ（「5分だけ始める」の5分後の知らせ。2026-11-08 追加）
--
-- しおりが「始めた」ことをサーバーに伝え、5分後にサーバーから通知を送る。
-- サーバーに置くのは「いつ・どの端末に送るか」と通知の種類だけ。取り組みの名前などの中身は置かない。
-- 通知の文面は種類ごとに固定（Edge Function「push」が持つ）。
--
-- 実行方法:
--   0001〜0004 を実行した後、Supabase ダッシュボード > SQL Editor でこのファイルを実行する。
--   何度実行しても安全。そのあと Edge Function「push」を登録する（README「9. 5分の知らせ」）。
--
-- 実行後の確認:
--   select jobname, schedule from cron.job;
--   → dispatch-due-pushes が * * * * *、cleanup-pushes が 1日1回 で登録されていること
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 通知を受け取る端末（ブラウザが発行する送り先）。本人の行だけ読み書きできる
create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

-- 送る予定。send_at はサーバーの時計で決める（端末の時計に左右されない）
create table if not exists public.push_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  endpoint text not null,
  kind text not null check (kind in ('five_min', 'test')),
  send_at timestamptz not null,
  sent_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, endpoint) references public.push_subscriptions (user_id, endpoint) on delete cascade
);
create index if not exists push_schedules_due_idx
  on public.push_schedules (send_at) where sent_at is null and canceled_at is null;

-- 送り先の URL と VAPID の鍵（1行のみ）。鍵は Edge Function が初回に作って入れる。
-- クライアントからは読み書きさせない（ポリシーなし）
create table if not exists public.push_config (
  id smallint primary key default 1 check (id = 1),
  function_url text,
  vapid_public_key text,
  vapid_private_key text
);
insert into public.push_config (id) values (1) on conflict (id) do nothing;

alter table public.push_subscriptions enable row level security;
alter table public.push_schedules enable row level security;
alter table public.push_config enable row level security;

revoke all on public.push_subscriptions from anon;
revoke all on public.push_schedules from anon, authenticated;
revoke all on public.push_config from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_schedules to authenticated;
grant select, insert, update, delete on public.push_subscriptions, public.push_schedules, public.push_config to service_role;

drop policy if exists own_rows_select on public.push_subscriptions;
drop policy if exists own_rows_insert on public.push_subscriptions;
drop policy if exists own_rows_update on public.push_subscriptions;
drop policy if exists own_rows_delete on public.push_subscriptions;
create policy own_rows_select on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy own_rows_insert on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_rows_update on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_rows_delete on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists own_rows_select on public.push_schedules;
create policy own_rows_select on public.push_schedules
  for select to authenticated using ((select auth.uid()) = user_id);

-- 端末を登録する。あわせて Edge Function の URL を覚える（アプリが自分の Supabase の URL から作って渡す）
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_function_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://' then
    raise exception '送り先が正しくありません' using errcode = '22023';
  end if;
  if p_function_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/push$' then
    raise exception 'Edge Function の URL が正しくありません' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
  update public.push_config set function_url = p_function_url where id = 1;
end;
$$;

-- 送る予定を入れる。何秒後かだけを受け取り、時刻はサーバーで決める
create or replace function public.schedule_push(p_endpoint text, p_kind text, p_delay_seconds int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;
  if p_delay_seconds is null or p_delay_seconds < 30 or p_delay_seconds > 7200 then
    raise exception '送るまでの時間は30秒〜2時間にしてください' using errcode = '22023';
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint) then
    raise exception 'この端末は通知の登録がまだです' using errcode = '22023';
  end if;
  insert into public.push_schedules (user_id, endpoint, kind, send_at)
  values (auth.uid(), p_endpoint, p_kind, now() + make_interval(secs => p_delay_seconds))
  returning id into new_id;
  return new_id;
end;
$$;

-- 送る予定を取り消す（5分より前に済にしたときなど）。送ったあとは何もしない
create or replace function public.cancel_push(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_schedules set canceled_at = now()
   where id = p_id and user_id = auth.uid() and sent_at is null and canceled_at is null;
$$;

-- 0007 で戻り値に body を足したので、再実行しても型が合わなくならないよう作り直す
drop function if exists public.claim_due_pushes(timestamptz);
-- 時刻が来た予定を「送った」にして返す（Edge Function だけが呼ぶ）。
-- 30分以上前の予定は送らない（サーバーが止まっていたあとに古い知らせがまとめて来ないように）
create or replace function public.claim_due_pushes(at timestamptz default now())
returns table (id uuid, kind text, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = ''
as $$
  with due as (
    update public.push_schedules s set sent_at = at
     where s.sent_at is null and s.canceled_at is null
       and s.send_at <= at and s.send_at > at - interval '30 minutes'
    returning s.id, s.kind, s.user_id, s.endpoint
  )
  select due.id, due.kind, due.endpoint, p.p256dh, p.auth
    from due join public.push_subscriptions p on p.user_id = due.user_id and p.endpoint = due.endpoint;
$$;

-- 1分おき：時刻が来た予定があるときだけ Edge Function を呼ぶ（呼び出し回数を増やさない）
create or replace function public.dispatch_due_pushes(at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
begin
  if not exists (
    select 1 from public.push_schedules
     where sent_at is null and canceled_at is null
       and send_at <= at and send_at > at - interval '30 minutes'
  ) then
    return;
  end if;
  select function_url into url from public.push_config where id = 1;
  if url is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'dispatch')
  );
end;
$$;

-- 1日1回：古い予定と、cron の実行記録を消す（データベースの容量を増やさない）
create or replace function public.cleanup_pushes(at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_schedules where created_at < at - interval '7 days';
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < $1' using at - interval '7 days';
  end if;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.schedule_push(text, text, int) from public, anon;
revoke all on function public.cancel_push(uuid) from public, anon;
revoke all on function public.claim_due_pushes(timestamptz) from public, anon, authenticated;
revoke all on function public.dispatch_due_pushes(timestamptz) from public, anon, authenticated;
revoke all on function public.cleanup_pushes(timestamptz) from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.schedule_push(text, text, int) to authenticated;
grant execute on function public.cancel_push(uuid) to authenticated;
grant execute on function public.claim_due_pushes(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-due-pushes') then
    perform cron.unschedule('dispatch-due-pushes');
  end if;
  if exists (select 1 from cron.job where jobname = 'cleanup-pushes') then
    perform cron.unschedule('cleanup-pushes');
  end if;
end $$;

select cron.schedule('dispatch-due-pushes', '* * * * *', $$select public.dispatch_due_pushes();$$);
select cron.schedule('cleanup-pushes', '17 19 * * *', $$select public.cleanup_pushes();$$);
