-- ============================================================================
-- しおり 0006：始めた記録（start）も同期できるようにする（2026-11-08）
--
-- 「5分だけ始める」「その場の5分」で始めた・終えた記録を iPhone と iPad で同期する。
-- 中身は今までどおり端末で暗号化してから置く。
--
-- 実行方法:
--   0005 を実行した後、Supabase ダッシュボード > SQL Editor でこのファイルを実行する。
--   何度実行しても安全。
--
-- 実行後の確認:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'encrypted_records_kind_check';
--   → 'start' が含まれていること
-- ============================================================================

alter table public.encrypted_records drop constraint if exists encrypted_records_kind_check;
alter table public.encrypted_records add constraint encrypted_records_kind_check
  check (kind in ('track', 'step', 'plan', 'journal', 'leftover', 'routine', 'start'));
