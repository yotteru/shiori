#!/usr/bin/env bash
# supabase/migrations をローカルの素の Postgres で試す。
# 使い方: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-sql.sh
# 本番の Supabase には実行しないこと（データベースを作り直す）
set -euo pipefail
cd "$(dirname "$0")/.."
DB=shiori_sql_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
run -f supabase/tests/stubs.sql
# 拡張機能はもどきで代用するので create extension の行は飛ばす。2回ずつ流して再実行の安全も確かめる
for pass in 1 2; do
  for f in supabase/migrations/*.sql; do
    grep -v '^create extension' "$f" | run
  done
done
run -f supabase/tests/migrations_test.sql
