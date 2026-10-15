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

## 處理回報疑義

使用者按題目下方的「回報疑義」會寫進 `reports` 表（沒登入也能回報）。網站上沒有人讀得到這張表，只能從 Dashboard 看：

1. Supabase Dashboard → Table Editor → `reports`，用 `status = open` 篩選還沒處理的。
2. 欄位：`question_id`（例如 `115090_1_062`）、`reason`（`answer` 答案有誤、`typo` 錯字、`image` 圖片、`subject` 學科分類、`other` 其他）、`note` 補充說明、`picked` 回報時選的答案、`build` 當時的網站版本。
3. 確認有錯：在 `pipeline/overrides/` 寫修正並寫明原因，重跑 pipeline（正解有變就重跑 `export_keys.py` 再 `npm run db:push`）。
4. 在 Dashboard 把 `status` 改成 `fixed`（已修正）或 `rejected`（題目沒錯），`admin_note` 寫處理方式。

**不要執行 `supabase config push`**：它會用 `config.toml` 的預設值覆蓋線上的登入設定（Site URL、Google 登入、關閉 Email 註冊等）。
