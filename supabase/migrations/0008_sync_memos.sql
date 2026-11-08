-- ============================================================================
-- しおり 0008：メモ箱（memo）も同期できるようにする（2026-11-08）
--
-- 中身は今までどおり端末で暗号化してから置く。
--
-- 実行方法:
--   0007 を実行した後、Supabase ダッシュボード > SQL Editor でこのファイルを実行する。
--   何度実行しても安全。
--
-- 実行後の確認:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'encrypted_records_kind_check';
--   → 'memo' が含まれていること
-- ============================================================================

alter table public.encrypted_records drop constraint if exists encrypted_records_kind_check;
alter table public.encrypted_records add constraint encrypted_records_kind_check
  check (kind in ('track', 'step', 'plan', 'journal', 'leftover', 'routine', 'start', 'memo'));
