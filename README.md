# しおり

寝る前に「明日のルート」を組み、朝は「最初の一手」から始め、終わったら「済」をつける自己管理アプリ（v0）。

- 実装指示書：[docs/CLAUDE_CODE_INSTRUCTIONS.md](docs/CLAUDE_CODE_INSTRUCTIONS.md)
- 公開URL：https://yotteru.github.io/shiori/
- データは各端末の中にあり、iPhone と iPad の同期を使うと、端末内で暗号化したデータだけがサーバー（Supabase）を通ります。サーバーからは中身を読めません。

## 検証期間（事前登録）

- 開始日：____年__月__日（運用を始めた日に記入）
- 期間：開始日から **7日間**
- 合格：**7日中、計画した夜が4日以上、かつ済が1つ以上ついた日が4日以上**
- 使いながら改善を続ける（2026-11-08 に「期間中は機能を足さない」ルールは削除）。思いついたことは [ideas.md](ideas.md) にメモしてよい

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
3. [supabase/migrations/0003_sync.sql](supabase/migrations/0003_sync.sql)（iPhone と iPad の同期）
4. [supabase/migrations/0004_sync_routines.sql](supabase/migrations/0004_sync_routines.sql)（いつもの固定の同期）
5. [supabase/migrations/0005_web_push.sql](supabase/migrations/0005_web_push.sql)（5分の知らせ。手順 9 も必要）
6. [supabase/migrations/0006_sync_starts.sql](supabase/migrations/0006_sync_starts.sql)（始めた記録の同期）
7. [supabase/migrations/0007_start_reminders.sql](supabase/migrations/0007_start_reminders.sql)（予定の開始時刻の通知。手順 10 も必要）
8. [supabase/migrations/0008_sync_memos.sql](supabase/migrations/0008_sync_memos.sql)（メモ箱の同期）
9. [supabase/migrations/0009_sync_changes_measures.sql](supabase/migrations/0009_sync_changes_measures.sql)（変化メモと数値型の記録の同期）

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

1. 設定 →「**通知**」→「23時の LINE」の **テスト送信** を押し、LINE に「（テスト）」付きのメッセージが届くことを確認する
2. 定時の通知を試すときは、SQL Editor で通知時刻を数分後に変える

```sql
update public.notification_state set notify_time = '21:30', last_sent_life_date = null where id = 1;
```

試し終わったら 23:00 に戻します。

```sql
update public.notification_state set notify_time = '23:00' where id = 1;
```

明日のルートを組み済みの日は届きません。

### 8. iPad でも使う（同期）

1. **iPhone**：設定 →「iPhone と iPad の同期」→ **同期を始める**（合言葉が未設定なら、ここで決める）
2. **iPad**：Safari で公開URLを開き、ホーム画面に追加 → 同じメールアドレスとパスワードでログイン
3. iPad の初回案内の下にある「**もう一方の端末と同期する**」に、iPhone と同じ合言葉を入れる
4. 以後は、開いた時と変更のたびに自動で同期します（設定の「今すぐ同期」でも可）

### 9. 5分の知らせ（Web プッシュ）

「5分だけ始める」の知らせを、サーバーから iPhone（画面が消えていれば Apple Watch）へ通知で送ります。秘密の値を登録する作業はありません。

**① SQL を実行する（1回だけ）**

1. Supabase ダッシュボード → 左の **SQL Editor**
2. [supabase/migrations/0005_web_push.sql](supabase/migrations/0005_web_push.sql) の中身を全部コピーして貼り付け → **Run**
3. 「Success」と出れば完了

**② 通知を送るプログラムを登録する（1回だけ）**

1. Supabase ダッシュボード → 左の **Edge Functions** → **Deploy a new function**（または「Create a new function」）→ **Via Editor**
2. 関数の名前を **push** にする（一字一句このとおり）
3. エディタの中身を全部消し、[supabase/functions/push/index.ts](supabase/functions/push/index.ts) の中身を全部貼り付ける
4. **Deploy function** を押す
5. 公開された push の画面 → **Details**（または Settings）→「**Verify JWT**」（JWT の検証）を**オフ**にして保存
   - オンのままだと、サーバーの1分おきの確認から呼べません

**③ iPhone で受け取る準備をする**

1. ホーム画面のしおり → 設定 →「**通知**」→「この端末で受け取る」の **この端末で通知を受け取る** → 通知を「許可」
2. **テスト：1分後に届く** を押し、iPhone の画面を消して待つ → 1〜2分で「テストの通知です」が届けば完了
3. 集中モード「しおり」でもしおりの通知が届くよう、設定アプリ → 集中モード → しおり →「通知を許可」の App に **しおり** を追加する
4. 「5分だけ始める」で集中モードもオンにしたいときは、[docs/SHORTCUTS.md](docs/SHORTCUTS.md) のとおりショートカット「しおり5分」を作り、設定 →「始め方」でチェックを入れる

### 10. 予定の開始時刻の通知

カレンダーに置いた今日・明日の行き先の時刻に、iPhone（画面が消えていれば Apple Watch）へ通知します。手順 9 が済んでいることが前提です。設定の「通知」で「終わる時刻にも知らせる」をオンにすると、終わる時刻にも届きます（済をつけるきっかけに。追加の SQL は不要です）。

**① SQL を実行する（1回だけ）**

SQL Editor で [supabase/migrations/0007_start_reminders.sql](supabase/migrations/0007_start_reminders.sql) の中身を全部貼り付けて **Run**。

**② 通知を送るプログラムを新しい中身にする（1回だけ）**

1. Supabase ダッシュボード → **Edge Functions** → **push** を開く
2. 上のタブの **Code**（コード）を開く
3. 中身を全部消し、https://raw.githubusercontent.com/yotteru/shiori/main/supabase/functions/push/index.ts の中身を全部貼り付ける
4. **Deploy**（または Save / Update）を押す
5. **Details** で「Verify JWT」が**オフ**のままか確かめる

**③ しおりで設定する**

設定 →「**通知**」→「予定の開始時刻」の「開始時刻に知らせる」にチェック。タイミング（ちょうど〜30分前）・対象（すべて／その日の最初だけ）・文面を選ぶ。
文面に `{行き先}` と書くと行き先の名前が入ります（名前は通知を送るまでサーバーに置かれ、送ったら消えます）。

確かめ方：今日のカレンダーで、数分後の時刻に行き先を置き、画面を消して待つ。

## 使い方の要点

- **1日の区切りは朝4時**。夜0:30に組んだ計画も「翌朝のしおり」になります
- しおりタブの下の **「今日」「明日」「週」でいつでも切り替え** られます。カレンダーの上で**左右にスライド**しても切り替わります（時間帯で画面は変わりません）。よく使う操作（候補・5分だけ始める・済・＋ボタン）は画面の下半分にまとめています。今日・明日は縦のカレンダーで、候補を持って時刻をタップするか「空き」の札をタップして置き、予定を選んでドラッグで動かします
- 仕事・食事などは、設定の「**いつもの固定**」で曜日ごとに決めておくと、毎日カレンダーの左の列に置かれます。歯医者などその日だけの予定は、**左の固定の列の空いた所をタップ**して足せます
- **明日**：明日のルートを組む（夜でも昼でも）。保存すると、その晩の23時の通知は届きません
- **今日**：次の行き先の「**5分だけ始める**」→ スマホを置く（5分後に通知。画面のタイマーはない）→ 終わったら「済」、途中でやめるなら「ここまで」（次はここから・理由はどちらも任意）。押さなくても予定の終わり時刻に自動で終わります。済は「今回の分をやった」の意味で、プロジェクト型のステップは「このステップは完了」をオンにしたとき（または取り組みタブで完了にしたとき）だけ終わります。同じ行き先は1日に何回でも置けます。計画にないこと（仕事など）は「▶ ほかのことを5分」（行き先がないときは「何か5分だけ始める」）から始める。「行き先を足す・並べ替える」でいつでも直せます。計画がなければ、その場で今日の分を組めます
- **答え合わせ・1行ジャーナル**：「今日」の下の「振り返り」からいつでも。昨日の答え合わせが残っていれば、振り返りのボタンにオレンジの点が付き、シートのいちばん上に出ます
- **バックアップ**：合言葉を設定すると、夜の計画保存のたびに暗号化して自動バックアップ。7日書き出していなければ、夜の流れの完了画面に Google ドライブへの書き出しボタンが出ます
- **動作確認**（開発用）：`npm run dev` で開いたときだけ、設定の一番下に「開発用：今の日時を指定する」が出ます。日付をずらして試せます（上書き中は画面上部にオレンジの帯）。公開しているアプリには出ません
- **メモ箱**：思いついたことは、取り組みタブのメモ箱に1行で入れる。メモのままでは候補に出ない。取り組みにしたくなったら「整える」（なりたい状態 → 習慣か終わりがあるか → ステップと最初の一手）
- **週**：しおりタブの「週」で月〜日を見る（カレンダーとリストを切り替え）。日をタップして、その日だけの予定（終日も可）・休日・「この日にやること」の札を決める。札を付けた取り組みは、前の晩にその日を組むとき候補の先頭に「札」の印つきで並ぶ。記録タブの7マスで、その週に何が埋まったかを眺める
- **数値型（体重など）**：取り組みを「数値型」で作り（単位と目標は任意）、記録タブのグラフの「＋ 測る」から数字を入れる。記録タブに線グラフ
- **空いていた時間**：振り返りのシートで、今日の過ぎた空きに「休んだ／スマホ・だらだら／予定外の用事」の印を付けられる（任意）。記録タブに週ごとの内訳と、だらだらになりやすい時間帯が出る
- **記録タブ**：週の7マス（習慣は手応えが強いほど濃い。「前の晩に組んだ」の段つき。マスをタップするとその日のふりかえりへ）、習慣型の「変化メモ」、いちばん下に「ふりかえり」（1行ジャーナル・済・変化メモ・測った値を新しい順に）
- **札のぶんを置く**：明日（今日）の画面で、週の札を付けた取り組みを空きにまとめて仮に置く。あとで動かして調整する
- **誘惑を遠ざける**：[docs/SCREEN_TIME.md](docs/SCREEN_TIME.md)（スクリーンタイムとオートメーション）。集中モードの切り忘れ防止は [docs/SHORTCUTS.md](docs/SHORTCUTS.md) のステップ3

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
