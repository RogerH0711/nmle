# 資料庫（Supabase）

- `migrations/`：資料表、權限（Row Level Security）、判分 trigger、排行榜函式。檔名開頭是時間，依序套用。
- `seed/question_keys.sql`：各題正解，由 `pipeline/export_keys.py` 產生，不要手動修改。
- `tests/`：用 PGlite 模擬 Supabase 實際執行 migration 與 seed，檢查權限、判分、排行榜。`npm run test:db`，GitHub Actions 每次 push 都會跑，沒過就不會部署。
- `config.toml`：Supabase CLI 的設定，`supabase init` 產生。

## 用 Supabase CLI 推送變更

CLI 已經列在根目錄的 `package.json`（固定版本），`npm install` 後用 `npx supabase` 執行。

### 第一次設定（每台電腦一次，由 Roger 自己在終端機執行）

```bash
npm install
npx supabase login
npx supabase link --project-ref gppcwxkhkzfogdfudebu
```

- `login` 會開瀏覽器登入 Supabase，存取權杖存在這台電腦，不會進 repo。
- `link` 會問資料庫密碼（Supabase Dashboard → Project Settings → Database 可以重設），只存在這台電腦。

前兩個 migration 是在 SQL Editor 手動執行的，CLI 不知道它們已經套用過。連結後要標記一次，否則 CLI 會想重新執行它們：

```bash
npx supabase migration repair --status applied 20261014000000 20261015000000
```

### 之後每次改資料庫

1. 在 `migrations/` 新增檔案（例如 `20261020000000_mock_exam.sql`），並在 `tests/` 加對應的測試。
2. `npm run test:db` 通過。
3. `npm run db:push:dry` 看會套用哪些 migration。
4. `npm run db:push` 套用 migration；正解檔有變更時也會一起執行。
5. `npm run db:status` 確認遠端狀態。

## 備份線上資料

免費方案沒有自動備份。登入使用者的紀錄只存在 Supabase（登出時會清掉裝置上的副本），所以由 Roger 每週一次、以及 `db:push` 有新 migration 之前，在自己的電腦備份：

1. 打開 Docker Desktop，等它啟動完：CLI 連線上專案時是在 Docker 容器裡跑 `pg_dump`（11/20 查過 CLI 2.121 的實作）。詳解批次這類吃記憶體的工作在跑時先不要開。
2. `npm run db:backup`：存到 `~/nmle-backups/<日期時間>/` 的 `roles.sql`、`schema.sql`、`data.sql`，做法照官方的 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。要放別的地方：`npm run db:backup -- D:\某個資料夾`；資料夾在 repo 裡面會拒絕。
3. 最後會列出各表筆數；`data.sql` 沒有 `auth.users`、或 public 的表全部 0 筆時會報錯。

`data.sql` 有使用者的 Email、密碼雜湊和全部作答紀錄：不要 commit、不要放到公開的地方（包括 GitHub Actions，公開 repo 的產出別人下載得到），舊的留最近幾份就好。

還原（只有專案救不回來時才需要）：照官方指南建新專案，用 `psql` 依序執行 `roles.sql`、`schema.sql`、`SET session_replication_role = replica`、`data.sql`。登入設定（Google OAuth、Site URL、關閉 Email 註冊、Turnstile）不在備份裡，要在新專案的 Dashboard 重設；前端的網址和 publishable key（`web/src/supabase.ts`）也要換。

## 專案被暫停時

免費方案一週內沒有足夠的資料庫活動會自動暫停專案（暫停前一週寄警告信、暫停時再寄一封）。恢復期限：11/20 收到的信寫 90 天，官方文件（[Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)）寫 1 年，以 Dashboard 為準；超過就只能下載資料。11/20 發生過一次。

預防：`.github/workflows/keepalive.yml` 每天三次用 publishable key 查一次資料庫（官方文件說一週內每天有幾次對資料庫的請求通常就夠，打 API 也算活動，但不保證）。這個 workflow 失敗時 GitHub 會寄信，通常代表專案已經被暫停。公開 repo 60 天沒有活動時 GitHub 會停用排程，要到 Actions 頁面重新啟用。

- 症狀：網站的登入、同步、排行榜、回報都失敗（作答照樣存在瀏覽器，恢復後自動補傳）；專案網址 `gppcwxkhkzfogdfudebu.supabase.co` 的 DNS 查不到；`db:push` 出現 `unexpected login role status 544 ... connection timeout`。
- 恢復：Dashboard 打開專案 → Restore project。等「Status」底下每一項（Database、PostgREST、Auth、Realtime、Storage）都變 Healthy 再操作：只有 Database 好了時 `db:push` 一樣會逾時；服務起來後 API 還要再一兩分鐘才讀得到資料表（11/20：19:50 服務回應、19:52 讀得到資料表）。
- 確認：`curl -H "apikey: <publishable key>" https://gppcwxkhkzfogdfudebu.supabase.co/rest/v1/profiles?select=*&limit=1` 回 200（RLS 下沒登入看到的是 `[]`）；回 `PGRST205`（找不到資料表）就是還沒載入完，再等一下。

## 處理回報疑義

使用者按題目下方的「回報疑義」會寫進 `reports` 表（沒登入也能回報）。網站上沒有人讀得到這張表，只能從 Dashboard 看：

1. Supabase Dashboard → Table Editor → `reports`，用 `status = open` 篩選還沒處理的。
2. 欄位：`question_id`（例如 `115090_1_062`）、`reason`（`answer` 答案有誤、`typo` 錯字、`image` 圖片、`subject` 學科分類、`other` 其他）、`note` 補充說明、`picked` 回報時選的答案、`build` 當時的網站版本。
3. 確認有錯：在 `pipeline/overrides/` 寫修正並寫明原因，重跑 pipeline（正解有變就重跑 `export_keys.py` 再 `npm run db:push`）。
4. 在 Dashboard 把 `status` 改成 `fixed`（已修正）或 `rejected`（題目沒錯），`admin_note` 寫處理方式。

## 處理排行榜灌分或不雅暱稱

不刪帳號，只讓別人在排行榜上看不到他（他自己看得到，不會發現被隱藏）：

1. 在排行榜看到的是暱稱，先在 Table Editor → `profiles` 用 `display_name` 找到那一筆（暱稱可能重複，對照註冊時間 `created_at`）。
2. 把 `hidden` 改成 `true`。不雅暱稱也可以順便把 `display_name` 改回「同學」加四碼。
3. 誤判的話改回 `false`。

## 查使用統計

`usage_daily` 是匿名的使用統計：每台裝置每天一筆（隨機的裝置代碼、當天在這台裝置作答幾題、有沒有開角色模式、有沒有登入）。沒登入的人也會記到，所以比 `profiles` 準。一台裝置不等於一個人：同一人用手機和電腦算兩台，清掉瀏覽器資料會換新代碼。

在 Dashboard → SQL Editor 執行：

```sql
-- 最近 14 天，每天有幾台裝置打開網站、幾台有作答、總共作答幾題
select day,
       count(*) as 打開網站,
       count(*) filter (where answered > 0) as 有作答,
       sum(answered) as 作答題數,
       count(*) filter (where signed_in) as 有登入,
       count(*) filter (where character_mode) as 角色模式
from usage_daily
where day > current_date - 14
group by day
order by day desc;

-- 最近 7 天有作答的裝置數，以及每台裝置作答幾天、幾題
select count(*) as 裝置數, round(avg(days), 1) as 平均天數, round(avg(total)) as 平均題數
from (select device_id, count(*) as days, sum(answered) as total
      from usage_daily
      where day > current_date - 7 and answered > 0
      group by device_id) t;

-- 每台裝置第一次出現的日期（看新來的人和留下來的人）
select first_day, count(*) as 新裝置
from (select device_id, min(day) as first_day from usage_daily group by device_id) t
group by first_day
order by first_day desc;
```

**不要執行 `supabase config push`**：它會用 `config.toml` 的預設值覆蓋線上的登入設定（Site URL、Google 登入、關閉 Email 註冊等）。
