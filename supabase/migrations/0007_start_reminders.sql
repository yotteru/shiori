-- ============================================================================
-- しおり 0007：予定の開始時刻の通知（2026-11-08 追加）
--
-- カレンダーに置いた行き先の開始時刻（設定で「○分前」も可）に、Web プッシュで知らせる。
-- アプリが今日・明日の分を計算し、端末ごとに丸ごと置き換える（計画を動かすたびに送り直す）。
-- 文面は設定で決める。「{行き先}」を使ったときだけ行き先の名前がサーバーに置かれ、送ったら消す。
--
-- 実行方法:
--   0005・0006 を実行した後、Supabase ダッシュボード > SQL Editor でこのファイルを実行する。
--   何度実行しても安全。そのあと Edge Function「push」を新しい中身で登録し直す（README「10. 開始時刻の通知」）。
-- ============================================================================

alter table public.push_schedules add column if not exists body text;
alter table public.push_schedules drop constraint if exists push_schedules_kind_check;
alter table public.push_schedules add constraint push_schedules_kind_check
  check (kind in ('five_min', 'test', 'start'));
alter table public.push_schedules drop constraint if exists push_schedules_body_len;
alter table public.push_schedules add constraint push_schedules_body_len
  check (body is null or char_length(body) <= 200);

-- この端末の「開始時刻の通知」を丸ごと置き換える。
-- p_items = [{ "send_at": "2026-11-09T10:55:00+09:00", "body": "…" }, …]（最大50件。2日より先・過去は捨てる）
create or replace function public.set_start_reminders(p_endpoint text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint) then
    raise exception 'この端末は通知の登録がまだです' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception '通知の数が多すぎます' using errcode = '22023';
  end if;

  delete from public.push_schedules
   where user_id = auth.uid() and endpoint = p_endpoint and kind = 'start' and sent_at is null;

  insert into public.push_schedules (user_id, endpoint, kind, send_at, body)
  select auth.uid(), p_endpoint, 'start', (x->>'send_at')::timestamptz, left(nullif(x->>'body', ''), 200)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
   where (x->>'send_at')::timestamptz > now()
     and (x->>'send_at')::timestamptz < now() + interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 時刻が来た予定を「送った」にして返す。文面（名前を含むことがある）は返したらサーバーから消す
drop function if exists public.claim_due_pushes(timestamptz);
create or replace function public.claim_due_pushes(at timestamptz default now())
returns table (id uuid, kind text, endpoint text, p256dh text, auth text, body text)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select s.id, s.kind, s.user_id, s.endpoint, s.body
      from public.push_schedules s
     where s.sent_at is null and s.canceled_at is null
       and s.send_at <= at and s.send_at > at - interval '30 minutes'
     for update skip locked
  ), upd as (
    update public.push_schedules s set sent_at = at, body = null
      from due where s.id = due.id
    returning s.id
  )
  select due.id, due.kind, due.endpoint, p.p256dh, p.auth, due.body
    from due
    join upd on upd.id = due.id
    join public.push_subscriptions p on p.user_id = due.user_id and p.endpoint = due.endpoint;
$$;

revoke all on function public.set_start_reminders(text, jsonb) from public, anon;
grant execute on function public.set_start_reminders(text, jsonb) to authenticated;
revoke all on function public.claim_due_pushes(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_pushes(timestamptz) to service_role;
