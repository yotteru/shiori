# CLAUDE_CODE_INSTRUCTIONS.md — 自己管理アプリ v0（仮称：しおり）実装指示書

最終更新：2026-11-05（朝の簡易版の候補順を要件メモに合わせて修正。画面案との差分を明記）
正本：要件メモ（Claude Docs「自己管理アプリ 要件メモ」）。本書と矛盾する場合は、作業を止めてユーザーに確認すること。

---

## 0. このアプリが何をするか（平易な説明）

寝る前に「明日のルート」を組み、朝は考えずに「最初の一手」から始め、終わったら「済」をつける。それだけのアプリ。

1. **夜 23:00**：LINEに「明日のルートを組む時間です」と届く。本人はホーム画面のアイコンからアプリを開く
2. **夜の流れ（3分以内）**：今日の答え合わせ（済・未）→ 1行ジャーナル → 明日を組む
3. **朝**：「今日のしおり」を開くと、次の行き先・最初の一手・前回の続きだけが大きく出る
4. **済をつける**：その場で「次はここから」を1行残せる。これが次回の「前回の続き」になる

設計の核（変えてはいけない前提）：

- 入口は「眺める画面」ではなく「計画を組み立てる盤面」。全体のダッシュボードはv0で作らない
- 次の一手はアプリが勝手に決めない。本人が前夜に決めたものだけを出す
- 小言・連続記録（ストリーク）・自分で発行するご褒美は入れない
- 着手と再開のハードルを下げることが最優先。操作を増やす変更は慎重に

---

## 1. 構成

| 部品 | 採用 | 備考 |
|---|---|---|
| アプリ | 静的PWA（Vite + React + TypeScript） | iPhoneのホーム画面に追加して使う |
| 公開 | GitHub Pages | Viteの `base` をリポジトリ名に合わせる |
| 端末内データ | IndexedDB（Dexie.js） | 正本は端末内。`navigator.storage.persist()` を初回に要求 |
| 認証 | Supabase Auth（メール＋パスワード、本人1アカウントのみ） | 新規登録はダッシュボードで無効化 |
| 自動バックアップ | Supabase の `encrypted_backups` テーブル | 端末内で暗号化してから送る。サーバーは中身を読めない |
| 計画済みの記録 | Supabase の `planning_pings` テーブル | 送るのは日付だけ。日記などの中身は送らない |
| 通知 | Supabase pg_cron（10分おき）→ pg_net → LINE Messaging API（broadcast） | LINEの鍵はSupabase Vaultに置く |
| LINE | このアプリ専用のLINE公式アカウントを新設。友だちは本人のみ | 暮らしストックのアカウントは使わない（家族に届くため） |

依存は最小限にする：`react`, `react-dom`, `dexie`, `@supabase/supabase-js`, `vite-plugin-pwa`。UIライブラリは使わない。

参考実装：`yotteru/kurashi-stock`（Supabase pg_cron → LINE broadcast の構成、RLSの書き方、`supabase/migrations/` の運用）。**このリポジトリは変更しないこと。**

---

## 2. 用語とデータの定義

### 2.1 生活日（最重要）

**1日の区切りは朝4:00（JST）。** 0:00〜3:59 は前日扱い。

- `lifeDate(now) = (now を JST にし 4時間引いた日時) の日付`（`YYYY-MM-DD`）
- アプリ・Supabase の関数・テストのすべてで、この定義を1か所の関数から使う（`src/lib/lifeDate.ts`、SQL側は `public.life_date(timestamptz)`）
- 夜に組む計画は `planFor = lifeDate(now) + 1日`

### 2.2 IndexedDB スキーマ（`schemaVersion: 1`）

```ts
// 取り組み（アプリ内の呼び名。旧称「トラック」）
interface Track {
  id: string;            // uuid
  name: string;
  type: 'project' | 'habit';
  createdAt: string;     // ISO
  archivedAt?: string;   // 終了した取り組み
  // 習慣型の既定値
  defaultMinutes?: number;   // 例 90
  defaultFirstStep?: string; // 例 "バッグを持って家を出る"
  // 前回の続き（済をつけたときの「次はここから」）
  lastNote?: { text: string; at: string };
}

// プロジェクト型のステップ（地図のマス）
interface Step {
  id: string;
  trackId: string;
  order: number;
  title: string;
  minutes: number;       // 30〜90 目安。入力は 15分刻みの選択
  firstStep: string;     // 最初の一手（1行）
  status: 'todo' | 'done';
  doneAt?: string;
}

// 計画（1生活日に1件）
interface Plan {
  lifeDate: string;          // 'YYYY-MM-DD'（この計画を実行する日）
  window: { start: string; end: string }; // 'HH:mm'。使える時間帯
  createdAt: string;
  source: 'night' | 'morning-quick'; // 夜に組んだか、朝の簡易版か
  items: PlanItem[];         // 並び順 = 実行順
}

interface PlanItem {
  id: string;
  trackId: string;
  stepId?: string;           // プロジェクト型のみ
  title: string;
  minutes: number;
  firstStep: string;
  status: 'planned' | 'done' | 'undone';
  doneAt?: string;
  nextNote?: string;         // 済のときに書いた「次はここから」
}

// ジャーナル（1生活日に1件）
interface Journal {
  lifeDate: string;
  text: string;              // 1行想定だが長さ制限は 2000 文字
  updatedAt: string;
}

// やり残し（未になった計画項目）
interface Leftover {
  id: string;
  fromLifeDate: string;      // 未になった日
  item: PlanItem;
  shelvedAt?: string;        // 保留タブへ移った日時
}

interface Meta {
  key: 'meta';
  schemaVersion: 1;
  lastExportAt?: string;     // Googleドライブへの書き出し
  lastBackupAt?: string;     // Supabaseへの自動バックアップ
  debugNow?: string;         // 開発用の「今の日時」上書き（§6）
  onboarded: boolean;
}

interface Draft { key: string; value: string; updatedAt: string } // 入力途中の自動保存
```

### 2.3 候補の作り方（明日を組む画面の「まだ埋まっていない空白」）

並び順は次のとおり。同じものは重複させない。

1. **やり残し**：`fromLifeDate` が今日から3生活日以内で、まだ保留でないもの
2. **プロジェクト型**：各取り組みの未完了ステップのうち、`order` が最小のもの（取り組みごとに1件）。`lastNote` があれば「前回の続き」として添える
3. **習慣型**：各取り組みにつき1件。所要時間と最初の一手は既定値

やり残しは 3生活日を過ぎた時点で `shelvedAt` を付け、「保留」タブに移す。保留タブから候補に戻せる。

---

## 3. 画面と流れ

デザインはキャンバス「自己管理アプリ ダッシュボード案」の **案2-A（Plan）と案2-B（Today）** に合わせる。案1（ダッシュボード型）は不採用なので参照しない。

- 地色 `#F4F5F7`、文字 `#15181D`、補助文字 `#5B6470`、完了 `#0F766E`、次の一手 `#EA580C`、強調カード `#15181D`
- 本文 Noto Sans JP、数字 IBM Plex Mono
- タップ領域は 44px 以上。絵文字は使わない
- 画面案との差分（v0 では実装しない）：案2-A の候補にある「止まっている」「土台（ジャーナル）」「自由」という種類、案2-B 末尾の「全体のダッシュボードは〜」の一文。止まっている取り組みは通常の候補として出る。ジャーナルは夜の流れで書く

### 3.1 起動時の分岐

1. **ホーム画面から開いていない**（`display-mode: standalone` でない、かつ `navigator.standalone !== true`）
   → 入力画面を出さない。「共有 → ホーム画面に追加してから使ってください」の案内だけ表示する
2. 未ログイン → ログイン画面（新規登録ボタンは置かない）
3. `onboarded = false` → 初回案内：取り組みを1つ作る（名前・種類・習慣型なら既定値、プロジェクト型なら最初のステップ1つ以上）。完了で `onboarded = true`
4. それ以外 → §3.2 の判定へ

### 3.2 ホームの判定

- 現在が生活日の 20:00 以降 → 「夜の流れを始める」を最上部に出す（今日のしおりも下に見える）
- 今日の Plan がある → **今日のしおり**（案2-B）
- 今日の Plan がない → **朝の簡易版**：候補を3件出し、1タップで今日の最初の行き先にする（`source: 'morning-quick'` の Plan を作る。時間帯の指定は省略可）
  - 3件の選び方：§2.3 の対象となる候補を、**前回の続きが新しい順**（その取り組みの `lastNote.at`、なければ最後に済をつけた日時）に並べた上位3件。どちらもない候補は最後に回し、その中では §2.3 の順に並べる
  - 夜の「明日を組む」画面の候補順は §2.3 のまま（朝と夜で並べ方が違うのは意図どおり。朝は再開しやすいものを優先する）

### 3.3 今日のしおり（案2-B）

- 上部：進み具合（済の数 / 全体）と行き先の点列
- 済の行き先：「HH:mm 済」のスタンプ表示
- 次の行き先：黒いカード。昨夜決めた最初の一手、前回の続き、「最初の一手を始める」ボタン
- 「済をつける」→ シートで「次はここから」を1行入力（空欄でも閉じられる）
  - 書いた場合は `PlanItem.nextNote` と `Track.lastNote` を更新
  - プロジェクト型はステップを `done` にする
- **済の取り消し**：済をつけた直後に「取り消す」を5秒表示。しおり上でも長押しで未に戻せる
- 下部「今日埋まった空白」：その日に済をつけた取り組みについて、習慣型は今週7マス、プロジェクト型は「完了数 / 全ステップ数」

### 3.4 夜の流れ（3ステップ、各ステップは1画面）

1. **答え合わせ**：今日の Plan の各行き先を「済 / 未」で確定。未は `Leftover` に入る
2. **1行ジャーナル**：テキスト1つ。空でも進める
3. **明日を組む**（案2-A）
   - 使える時間帯を選ぶ（前回の値を初期値に）
   - 時間の残量バー。超えたら「時間が足りません。どれかを次の日に回しましょう」
   - 候補（§2.3）をタップでしおりに追加。↑で並び替え、×で外す。時刻は時間帯の開始から自動で割り付け（各行き先の間に10分）
   - 各行き先の「最初の一手」はその場で編集できる
   - **1件以上で「この計画で明日を迎える」が押せる**
4. 保存時に行うこと（順番に）：
   1. IndexedDB に Plan を保存
   2. Supabase `planning_pings` に `planned_for = planFor` を upsert
   3. 自動バックアップ（§4.1）
   4. 最後の書き出しから7日以上なら、「Googleドライブに書き出す」ボタンを完了画面に出す（押さなくても閉じられる）

  2と3が失敗しても1は成功扱い。失敗は完了画面に小さく表示し、次回保存時に再試行する。

### 3.5 取り組み

- 一覧：取り組みごとに、プロジェクト型はステップの地図（完了・次・未着手）、習慣型は直近の実施マス
- 止まっている取り組み（最後の済から7日以上）は「最後に触ってから N日・前回：〜」とだけ表示。責める文言は使わない
- 追加・名前変更・終了（アーカイブ）・ステップの追加・並び替え・編集
- 「保留」タブ：3日を過ぎたやり残し。候補に戻す / 削除

### 3.6 設定

- 自動バックアップの合言葉の設定・変更（§4.1）
- Googleドライブへ書き出す / ファイルから読み込む（§4.2）
- 通知のテスト送信ボタン（§5.3）
- ログアウト
- 開発用：「今の日時を指定する」（§6）。本番ビルドでも設定の一番下に置いてよい

### 3.7 入力途中の自動保存

ジャーナル・「次はここから」・最初の一手の編集は、入力のたびに `Draft` に保存する（500ms のデバウンス）。画面を開き直したら復元し、確定したら削除する。

---

## 4. バックアップ

### 4.1 自動バックアップ（暗号化してSupabaseへ）

- 合言葉は初回の夜の計画保存時に設定を求める（スキップ可。未設定の間は毎回の夜の流れ完了時に「合言葉を設定するとバックアップが始まります」と表示）
- 暗号化：Web Crypto API。PBKDF2（SHA-256、310,000回、16バイトの salt）で鍵を作り、AES-GCM（12バイトの IV）で全データの JSON を暗号化
- 合言葉そのものは保存しない。導出した鍵は `CryptoKey`（extractable: false）として IndexedDB に保持してよい
- 合言葉の入力欄は `autocomplete="new-password"` にし、iPhoneのパスワード管理に保存できるようにする
- 送るもの：`{ ciphertext, iv, salt, schemaVersion, created_at }`。最新7世代を残し、古いものは削除
- 復元：ログイン後、端末内が空のときに「バックアップから戻す」を出す。合言葉を入れて最新から復元

### 4.2 Googleドライブへの書き出し（手動）

- 形式：JSON（暗号化しない）。ファイル名 `shiori-backup-YYYYMMDD-HHmm.json`
- 中身：`{ format: 'shiori-backup', schemaVersion: 1, exportedAt, tracks, steps, plans, journals, leftovers }`
- 出し方：Web Share API（`navigator.share({ files })`）で共有メニューを開き、本人が「ファイルに保存 → Google ドライブ」を選ぶ。使えない環境ではダウンロードにフォールバック
- 読み込み：ファイル選択 → 形式と版番号を検証 → **読み込み直前に今のデータを自動で書き出す** → 確認ダイアログ → 置き換え
- 将来の Obsidian 連携（v0では作らない）のため、ジャーナル・済の記録は生活日をキーに持ち、Markdown に1日1ファイルで変換できる形を保つこと

---

## 5. Supabase

マイグレーションは `supabase/migrations/` に置き、**ユーザーが SQL Editor で手動実行する**（暮らしストックと同じ運用）。各ファイルの先頭に実行手順をコメントで書く。再実行しても安全にすること。

### 5.1 テーブル

```sql
-- 計画した日付（中身は送らない）
create table public.planning_pings (
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_for date not null,          -- 生活日
  created_at timestamptz not null default now(),
  primary key (user_id, planned_for)
);

-- 暗号化バックアップ
create table public.encrypted_backups (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,           -- base64
  iv text not null,
  salt text not null,
  schema_version int not null,
  created_at timestamptz not null default now()
);

-- 通知の状態（1行のみ）
create table public.notification_state (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  notify_time time not null default '23:00',
  last_sent_life_date date
);
```

- 3テーブルすべて RLS を有効化。`planning_pings` と `encrypted_backups` は `auth.uid() = user_id` のみ読み書き可。`notification_state` はクライアントから読み書きさせない
- `anon` 向けの全許可ポリシーを作らないこと（暮らしストック `0003_tighten_policies.sql` の教訓）
- `pg_net` は `extensions` スキーマに入れる

### 5.2 通知ジョブ

```text
public.life_date(ts timestamptz) returns date   -- (ts at time zone 'Asia/Tokyo' - interval '4 hours')::date
public.check_and_send_plan_reminder()           -- security definer、pg_cron から10分おきに実行
```

`check_and_send_plan_reminder` の判定（すべて満たしたときだけ送る）：

1. `enabled = true`
2. JST の現在時刻が `notify_time` 以上、`notify_time + 10分` 未満
3. `last_sent_life_date` が今日の生活日ではない
4. 明日の生活日（`life_date(now()) + 1`）の `planning_pings` が存在しない（もう計画済みなら送らない）

送信：`net.http_post` で `https://api.line.me/v2/bot/message/broadcast` に送る。アクセストークンは `vault.decrypted_secrets` から `name = 'line_channel_access_token'` で取得。**SQLファイルや Git にトークンを書かない。** 送信後 `last_sent_life_date` を更新。

文面（固定）：「明日のルートを組む時間です。ホーム画面の『しおり』から開いてください。」

### 5.3 テスト送信

`public.send_test_notification()`：ログイン中の本人だけが RPC で呼べる関数。判定を飛ばして同じ文面に「（テスト）」を付けて送る。設定画面のボタンから呼ぶ。

### 5.4 秘密値の扱い

LINE のトークン、Supabase の service_role キーなどの秘密値は、**チャットやリポジトリに書かせない**。ユーザーが Supabase ダッシュボード（Vault）で直接登録する手順を README に書く。クライアントに置いてよいのは Supabase の URL と anon（publishable）キーだけ。

---

## 6. 開発用の「今の日時」上書き

- アプリ内の「今」は必ず `src/lib/clock.ts` の `now()` から取る（`new Date()` を直接使わない）
- `Meta.debugNow` があればそれを返す。設定画面で日時を指定・解除できる。上書き中は画面上部に「テスト中：日時を上書きしています」と常時表示
- これで、生活日の切り替わり、やり残しの3日経過、7日書き出し催促、止まっている取り組みの日数をその場で確かめられること

---

## 7. ユーザーが手で行う作業（README に手順を書く）

1. このアプリ用の LINE 公式アカウントを作成し、Messaging API を有効化。本人のLINEで友だち追加
2. Supabase の新しいプロジェクトを作成（暮らしストックとは別）
3. Authentication で「Allow new users to sign up」をオフにし、本人のユーザーを1人だけ作成
4. Vault に `line_channel_access_token` を登録
5. SQL Editor でマイグレーションを順に実行し、`select * from cron.job;` でジョブ登録を確認
6. GitHub Pages を有効化し、公開URLを iPhone の Safari で開いて「ホーム画面に追加」
7. 設定画面の「テスト送信」で LINE に届くことを確認

---

## 8. 受け入れテスト

自動テスト（Vitest）：

1. `lifeDate`：JST 3:59 は前日、4:00 は当日。月末・年末をまたぐケース
2. 候補の作成：やり残し（3日以内）→ プロジェクト型の先頭ステップ → 習慣型 の順。重複なし
3. やり残しは3生活日を過ぎると保留に移る
4. 時刻の割り付け：開始時刻＋所要時間＋10分で順に並ぶ。超過時に警告状態になる
5. 暗号化 → 復号の往復で同一データに戻る。合言葉違いでは復号に失敗し、データを壊さない
6. 書き出し → 読み込みの往復で同一データに戻る。版番号が違うファイルは拒否する

手動テスト（`debugNow` を使う）：

7. Safari のタブで開くと案内だけが出て、入力できない
8. 初回案内で取り組みを1つ作ると、夜の流れの候補に出る
9. 夜の流れを最後まで進めると、翌生活日の朝にしおりが出る。0:30 に組んだ計画も翌朝のしおりになる
10. 計画がない朝は簡易版が出て、1タップで最初の行き先が決まる
11. 済をつけて「次はここから」を書くと、次回の候補と、しおりの「前回の続き」に出る。取り消しが効く
12. 入力途中でアプリを閉じて開き直すと、ジャーナルの書きかけが残っている
13. 計画保存後、Supabase に `planning_pings` と `encrypted_backups` が増える（中身が読めない形であること）
14. 7日書き出していないと、夜の流れの完了画面に書き出しボタンが出る
15. テスト送信で LINE に届く。`notify_time` を数分後に変えると定時でも届き、計画済みの日は届かない

---

## 9. やらないこと（v0）

全体のダッシュボード／数値型の取り組み／ヘルスケア・スクリーンタイムの自動取得／AIによる要約・フィードバック／仕事・睡眠の細かい時間管理／複数端末の同時利用／Obsidian 書き出し／通知時刻の設定画面（23:00 固定。変更は SQL で行う）／ストリーク・バッジ類

---

## 10. 検証期間（事前登録）

- 運用開始から **7日間**。README に開始日を記入する
- 合格：**7日中、計画した夜が4日以上、かつ済が1つ以上ついた日が4日以上**
- 期間中は機能を足さない。思いついたことは `ideas.md` にメモする（バグ修正は可）

---

## 11. 実装後のセルフレビュー観点

- 「今」を `clock.now()` 以外から取っている箇所がないか
- 生活日の計算がアプリと SQL で一致しているか（JST、4時区切り）
- Supabase への送信が失敗しても、端末内の保存が必ず先に完了しているか
- 合言葉や復号済みデータを、ログ・コンソール・エラーメッセージに出していないか
- RLS で本人以外が読めないか。`anon` の全許可ポリシーが残っていないか
- 秘密値がリポジトリに入っていないか
- iPhone の Safari（ホーム画面アプリ）で、時刻選択などの入力欄がはみ出さないか（暮らしストックでネイティブの時刻入力欄がはみ出した前例あり。`<select>` で代替する）

## 12. 進め方

- 着手前にこの指示書を読み、不明点や矛盾があれば作業を止めて選択肢を示し、ユーザーに確認すること
- 実装順の目安：§2 データ層と生活日 → §3.1〜3.4 の中核ループ（夜の流れ・しおり・簡易版）→ §3.5〜3.7 → §4 バックアップ → §5 Supabase と通知 → §8 テスト
- PR は段階ごとに分け、各PRの説明に「何が使えるようになったか」を平易な言葉で書くこと
