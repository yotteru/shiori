-- ============================================================================
-- しおり 0001：テーブル・RLS・生活日の関数
--
-- 実行方法:
--   Supabase ダッシュボード > SQL Editor にこのファイルの内容を貼り付けて実行する。
--   何度実行しても安全（既存のテーブル・ポリシーは作り直さず、上書きする）。
--
-- 実行後の確認:
--   select tablename, policyname, roles from pg_policies where schemaname = 'public';
--   → planning_pings / encrypted_backups に own_rows_* だけがあり、anon 向けのポリシーがないこと
--   select public.life_date('2026-11-05 03:59+09'), public.life_date('2026-11-05 04:00+09');
--   → 2026-11-04 / 2026-11-05
-- ============================================================================

-- 生活日：1日の区切りは JST 朝4:00（アプリの src/lib/lifeDate.ts と同じ定義）
create or replace function public.life_date(ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (ts at time zone 'Asia/Tokyo' - interval '4 hours')::date;
$$;

-- 計画した日付（中身は送らない）
create table if not exists public.planning_pings (
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_for date not null,          -- 生活日
  created_at timestamptz not null default now(),
  primary key (user_id, planned_for)
);

-- 暗号化バックアップ（サーバーは中身を読めない）
create table if not exists public.encrypted_backups (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,           -- base64
  iv text not null,
  salt text not null,
  schema_version int not null,
  created_at timestamptz not null default now()
);
create index if not exists encrypted_backups_user_created_idx
  on public.encrypted_backups (user_id, created_at desc);

-- 通知の状態（1行のみ）
create table if not exists public.notification_state (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  notify_time time not null default '23:00',
  last_sent_life_date date
);
insert into public.notification_state (id) values (1) on conflict (id) do nothing;

-- RLS：3テーブルすべて有効化
alter table public.planning_pings enable row level security;
alter table public.encrypted_backups enable row level security;
alter table public.notification_state enable row level security;

-- anon には何も許可しない（「誰でもOK」のポリシーを作らない）
revoke all on public.planning_pings from anon;
revoke all on public.encrypted_backups from anon;
revoke all on public.notification_state from anon, authenticated;

grant select, insert, delete on public.planning_pings to authenticated;
grant select, insert, delete on public.encrypted_backups to authenticated;

-- planning_pings：本人の行だけ
drop policy if exists own_rows_select on public.planning_pings;
drop policy if exists own_rows_insert on public.planning_pings;
drop policy if exists own_rows_delete on public.planning_pings;
create policy own_rows_select on public.planning_pings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy own_rows_insert on public.planning_pings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_rows_delete on public.planning_pings
  for delete to authenticated using ((select auth.uid()) = user_id);

-- encrypted_backups：本人の行だけ
drop policy if exists own_rows_select on public.encrypted_backups;
drop policy if exists own_rows_insert on public.encrypted_backups;
drop policy if exists own_rows_delete on public.encrypted_backups;
create policy own_rows_select on public.encrypted_backups
  for select to authenticated using ((select auth.uid()) = user_id);
create policy own_rows_insert on public.encrypted_backups
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_rows_delete on public.encrypted_backups
  for delete to authenticated using ((select auth.uid()) = user_id);

-- notification_state：クライアントからは読み書きさせない（ポリシーを作らない＝全拒否）
