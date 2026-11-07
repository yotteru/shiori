# しおり

寝る前に「明日のルート」を組み、朝は「最初の一手」から始め、終わったら「済」をつける自己管理アプリ（v0）。

- 実装指示書：[docs/CLAUDE_CODE_INSTRUCTIONS.md](docs/CLAUDE_CODE_INSTRUCTIONS.md)
- 公開URL：https://yotteru.github.io/shiori/
- データは iPhone の中が正本。サーバー（Supabase）に送るのは「計画した日付」と「暗号化したバックアップ」だけです。

## 検証期間（事前登録）

- 開始日：____年__月__日（運用を始めた日に記入）
- 期間：開始日から **7日間**
- 合格：**7日中、計画した夜が4日以上、かつ済が1つ以上ついた日が4日以上**
- 期間中は機能を足さない。思いついたことは [ideas.md](ideas.md) にメモする（バグ修正は可）

## 初期設定（利用者が手で行う作業）

秘密値（LINE のチャネルアクセストークン、Supabase の service_role キー）は、**チャット・リポジトリ・SQL ファイルに書かないでください**。必ず各サービスの管理画面に直接入力します。

### 1. LINE 公式アカウントを作る

1. [LINE Official Account Manager](https://manager.line.biz/) で、このアプリ専用の公式アカウントを新しく作る（暮らしストックのアカウントは使わない。家族に届くため）
2. 設定 → Messaging API → 「Messaging API を利用する」をオンにする（プロバイダーは任意）
3. [LINE Developers](https://developers.line.biz/console/) で、そのチャネルの「Messaging API設定」→「チャネルアクセストークン（長期）」を発行する。値は次の手順 4 で Vault に直接貼り付ける
4. 同じ画面の QR コードを自分の LINE で読み取り、友だち追加する（友だちは本人だけにする。broadcast は友だち全員に届くため）

### 2. Supabase のプロジェクトを作る

1. [Supabase](https://supabase.com/dashboard) で新しいプロジェクトを作る（暮らしストックとは別）。リージョンは Tokyo を推奨
2. **Authentication → Sign In / Providers**：「Allow new users to sign up」をオフにする
3. **Authentication → Users → Add user → Create new user**：本人のメールアドレスとパスワードで1人だけ作る（Auto Confirm をオン）

### 3. LINE のトークンを Vault に登録する

1. **Project Settings → Vault**（または **Integrations → Vault**）→ **Add new secret**
2. Name：`line_channel_access_token`、Secret：手順 1-3 で発行したチャネルアクセストークン

### 4. マイグレーションを実行する

**SQL Editor** で、次のファイルの中身を順に貼り付けて実行します（何度実行しても安全です）。

1. [supabase/migrations/0001_tables_and_rls.sql](supabase/migrations/0001_tables_and_rls.sql)
2. [supabase/migrations/0002_plan_reminder.sql](supabase/migrations/0002_plan_reminder.sql)

実行後、次の SQL でジョブが登録されていることを確認します。

```sql
select jobname, schedule from cron.job;
```

`check-plan-reminder` が `*/10 * * * *` で出ていれば完了です。

### 5. GitHub Pages で公開する

1. Supabase の **Project Settings → API** で `Project URL` と `anon`（publishable）キーを確認する（**service_role キーは使わない**）
2. このリポジトリの **Settings → Secrets and variables → Actions → Variables** に次の2つを登録する（anon キーは公開前提の鍵なので Variables でよい）
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. **Settings → Pages → Build and deployment → Source** を「GitHub Actions」にする
4. main にマージすると自動で公開される（手動で動かすときは Actions → Deploy to GitHub Pages → Run workflow）

### 6. iPhone に入れる

1. 公開URL https://yotteru.github.io/shiori/ を **Safari** で開く
2. 共有 → **ホーム画面に追加**
3. ホーム画面の「しおり」から開き、ログインする

### 7. 通知を確かめる

1. 設定 → **テスト送信** を押し、LINE に「（テスト）」付きのメッセージが届くことを確認する
2. 定時の通知を試すときは、SQL Editor で通知時刻を数分後に変える

```sql
update public.notification_state set notify_time = '21:30', last_sent_life_date = null where id = 1;
```

試し終わったら 23:00 に戻します。

```sql
update public.notification_state set notify_time = '23:00' where id = 1;
```

明日のルートを組み済みの日は届きません。

## 使い方の要点

- **1日の区切りは朝4時**。夜0:30に組んだ計画も「翌朝のしおり」になります
- **夜（20時以降）**：ホームの「夜の流れを始める」→ 答え合わせ → 1行ジャーナル → 明日を組む
- **朝**：しおりの「最初の一手を始める」→ 終わったら「済をつける」（次はここからを1行）
- **計画を忘れた朝**：候補3つから1タップで今日の行き先が決まります
- **バックアップ**：合言葉を設定すると、夜の計画保存のたびに暗号化して自動バックアップ。7日書き出していなければ、夜の流れの完了画面に Google ドライブへの書き出しボタンが出ます
- **動作確認**：設定の一番下「開発用：今の日時を指定する」で、日付をずらして試せます（上書き中は画面上部にオレンジの帯）

## 開発

```bash
npm install
cp .env.example .env.local   # Supabase の URL と anon キーを書く（なくても開発サーバーは動く）
npm run dev                  # 開発サーバー。ホーム画面判定と、Supabase 未設定時のログインを省略する
npm test                     # 自動テスト（Vitest）
npm run build                # 本番ビルド
```

マイグレーションのテスト（ローカルの Postgres 16 が必要。Supabase の機能は supabase/tests/stubs.sql のもどきで代用）：

```bash
PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres scripts/test-sql.sh
```

### 構成

| 場所 | 内容 |
|---|---|
| `src/lib/lifeDate.ts` | 生活日（JST 4時区切り）。SQL の `public.life_date` と同じ定義 |
| `src/lib/clock.ts` | アプリ内の「今」。開発用の日時上書きもここ |
| `src/lib/db.ts` | IndexedDB（Dexie） |
| `src/lib/candidates.ts` | 候補の並べ方（夜・朝） |
| `src/lib/actions.ts` | 済・取り消し・答え合わせ・計画保存などの操作 |
| `src/lib/backup.ts` `crypto.ts` | 暗号化自動バックアップ |
| `src/lib/exportFile.ts` `snapshot.ts` | 書き出し・読み込み |
| `src/ui/` | 画面 |
| `supabase/migrations/` | SQL Editor で手動実行するマイグレーション |
