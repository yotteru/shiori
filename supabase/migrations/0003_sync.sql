-- ============================================================================
-- しおり 0003：iPhone と iPad の同期（2026-11-07 追加）
--
-- 取り組み・計画・ジャーナルなどを1件ずつ端末内で暗号化して置く。サーバーは中身を読めない。
-- 同じ項目は「後から変えた方」を残す（client_updated_at が古い変更は受け付けない）。
--
-- 実行方法:
--   0001・0002 を実行した後、Supabase ダッシュボード > SQL Editor でこのファイルを実行する。
--   何度実行しても安全。
--
-- 実行後の確認:
--   select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('encrypted_records', 'sync_keys');
--   → own_rows_* だけがあること
-- ============================================================================

-- 暗号化した1件ずつのデータ
create table if not exists public.encrypted_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('track', 'step', 'plan', 'journal', 'leftover')),
  record_id text not null,
  ciphertext text not null,            -- base64
  iv text not null,
  deleted boolean not null default false,
  client_updated_at timestamptz not null, -- 端末で変更した時刻（どちらが後かの判定に使う）
  server_updated_at timestamptz not null default clock_timestamp(), -- 取り込みの目印
  primary key (user_id, kind, record_id)
);
create index if not exists encrypted_records_pull_idx
  on public.encrypted_records (user_id, server_updated_at);

-- 合言葉の確認用（salt と、決まった文字列を暗号化したもの）。合言葉そのものは置かない
create table if not exists public.sync_keys (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  salt text not null,
  check_ciphertext text not null,
  check_iv text not null,
  updated_at timestamptz not null default now()
);

alter table public.encrypted_records enable row level security;
alter table public.sync_keys enable row level security;

revoke all on public.encrypted_records from anon;
revoke all on public.sync_keys from anon;
grant select, insert, update on public.encrypted_records to authenticated;
grant select, insert, update on public.sync_keys to authenticated;

drop policy if exists own_rows_select on public.encrypted_records;
drop policy if exists own_rows_insert on public.encrypted_records;
drop policy if exists own_rows_update on public.encrypted_records;
create policy own_rows_select on public.encrypted_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy own_rows_insert on public.encrypted_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_rows_update on public.encrypted_records
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists own_rows_select on public.sync_keys;
drop policy if exists own_rows_insert on public.sync_keys;
drop policy if exists own_rows_update on public.sync_keys;
create policy own_rows_select on public.sync_keys
  for select to authenticated using ((select auth.uid()) = user_id);
create policy own_rows_insert on public.sync_keys
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_rows_update on public.sync_keys
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 送る：古い変更は受け付けず、その場合はサーバーにある行を返す。
-- security invoker なので RLS がそのまま効く（本人の行しか書けない）
create or replace function public.push_records(records jsonb)
returns setof public.encrypted_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  cur public.encrypted_records;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;
  for r in select value from jsonb_array_elements(records) loop
    insert into public.encrypted_records as e
      (user_id, kind, record_id, ciphertext, iv, deleted, client_updated_at, server_updated_at)
    values (
      auth.uid(), r->>'kind', r->>'record_id', r->>'ciphertext', r->>'iv',
      coalesce((r->>'deleted')::boolean, false), (r->>'client_updated_at')::timestamptz, clock_timestamp()
    )
    on conflict (user_id, kind, record_id) do update set
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      deleted = excluded.deleted,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = clock_timestamp()
    where excluded.client_updated_at >= e.client_updated_at;
    if not found then
      select * into cur from public.encrypted_records
       where user_id = auth.uid() and kind = r->>'kind' and record_id = r->>'record_id';
      return next cur;
    end if;
  end loop;
end;
$$;

revoke all on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;
