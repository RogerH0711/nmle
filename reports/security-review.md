# Security review 與 code review（公開到 Dcard 前）

日期：2026-10-25　範圍：`supabase/migrations/`、`supabase/seed/`、`web/src/`、`web/scripts/`、`data/`、`.github/workflows/`、git 歷史（67 個 commit）

## 方法與限制

- **靜態審查**：讀過全部 migration、前端與 Supabase 互動的程式、SEO 靜態頁產生器、CI 設定，並掃過工作目錄與 git 歷史裡的金鑰與個資。
- **實際重現**：用 repo 的 PGlite 測試環境（`supabase/tests/helpers.js`，套用全部 migration 與正解 seed）寫了一份 PoC 測試，放在 scratchpad，沒有進 repo。下文標「已重現」的項目都在 PGlite 上跑過；PGlite 只模擬 RLS 與函式，**不包含 GoTrue（登入服務）與 PostgREST 的設定**。
- **沒有碰線上環境**：沒有執行任何 `supabase` 指令，沒有對線上 Supabase 或網站送任何請求。Dashboard 上的設定（CAPTCHA、密碼長度、Redirect URL 等）repo 看不到，列在最後的「Dashboard 檢查清單」，要 Roger 自己確認。
- 標示方式：**事實**＝讀程式或 PoC 確認；**推論**＝依 Supabase/GoTrue 的行為推斷，還沒實測。

## 嚴重度定義

這個網站沒有金流、沒有敏感個資，作答紀錄外洩的傷害有限，所以嚴重度主要看「公開後會不會被拿來搞事、會不會讓使用者失去信任」：

- **高**：公開後任何人用瀏覽器開發者工具或幾行 curl 就能做到，而且別人看得到（排行榜）。
- **中**：可以讀到不該讀的資料、或能讓服務變慢／塞滿，但需要一點動機。
- **低**：影響小、或要很特別的條件。
- **資訊**：不是漏洞，但值得知道或寫進文件。

## 總表

| # | 嚴重度 | 項目 | 狀態 |
| --- | --- | --- | --- |
| H1 | 高 | 連續天數榜：`answered_at` 由前端決定，一次請求就能回填 365 天 | 已修（`20261025180000_leaderboard_integrity.sql`） |
| H2 | 高 | 模擬考榜：`started_at` 由前端決定，可以補一筆「更早的第一次」，滿分、0 秒 | 已修（同上） |
| H3 | 高 | 正解本來就公開（題庫 JSON、`q/` 靜態頁、repo 的 seed），週榜正確率可以直接刷到 100% | 第 1 點已修（同上）；照正解作答本身擋不住 |
| M1 | 中 | 任何登入者都能列出所有使用者的 user id、暱稱、註冊時間；與隱私權政策的說法不一致 | 已修（同上） |
| M2 | 中 | Google 帳號可以把 Email 改成任意地址，`check_username_email` 擋不到 | 已修（同上） |
| M3 | 中 | 寫入沒有數量限制：作答、模擬考、送禮、回報、使用統計可以灌爆免費方案的空間 | 已修（`20261025200000_rate_limits.sql`）；用量告警待 Roger 設定 |
| M4 | 中 | 匿名回報的「每小時 200 筆」是全站共用額度，任何人都能讓所有匿名回報失效 | 減輕（同上）；要完全擋住得加 CAPTCHA |
| M5 | 中 | 登入相關設定只在 Dashboard，repo 裡的 `config.toml` 與文件不一致（密碼長度 6 vs 8） | 密碼長度、CAPTCHA 已確認（10/25），其餘待確認 |
| L1 | 低 | 暱稱沒有伺服器端的內容檢查：純空白、RTL 控制字元、冒用別人的暱稱 | 已修（`20261025220000_display_name_rules.sql`）；同名沒擋，改用 `hidden` 處理 |
| L2 | 低 | 排行榜函式的門檻參數由前端決定，`min_daily = 1` 可以看到所有人的活躍狀況 | 已修（同上） |
| L3 | 低 | `rogerh0711.github.io` 是共用 origin，登入權杖存在 localStorage；沒有 CSP | CSP 已加；共用 origin 等 Roger 決定 |
| L4 | 低 | `answers.synced_at`、`profiles.created_at` 可以由前端指定或修改 | 已修（synced_at 在 `20261025180000`，created_at 在 `20261025220000`） |
| L5 | 低 | 刪除帳號與登出後，這台裝置上還留有資料；刪除時有 race | 已修（`web/src/account.ts`） |
| L6 | 低 | 帳號名稱可以被列舉（註冊時回「已經有人用了」） | 推論 |
| I1 | 資訊 | repo 沒有發現金鑰；commit 作者 email 是學號信箱 | 事實 |
| I2 | 資訊 | design.md 裡「送出作答後才向伺服器拿正解」的方案已經沒有意義 | design.md 已更新 |

Bug 與效能（B1–B7）在後半段。

**10/25 修正**：H1、H2、H3 第 1 點、M1、M2 由 `20261025180000_leaderboard_integrity.sql` 處理，並加了 PGlite 測試（`supabase/tests/db.test.js` 的「排行榜防偽造」等）。做法與取捨寫在 `docs/design.md`「技術架構」的「排行榜防偽造」。附錄的 PoC 在新的 schema 上重跑：回填 365 天最多只剩 3 天寬限內的 4 天、補一筆更早的模擬考不會取代第一次、改 Email 被擋。

**10/25 修正（二）**：M3、M4 由 `20261025200000_rate_limits.sql` 處理：作答、模擬考、送禮、登入後回報有每人每天的上限（10,000／100／300／100），使用統計每天最多記 5,000 台新裝置；匿名回報改成同一題每小時 10 筆、全站每天 1,000 筆（取代每小時 200 筆）。M4 只是減輕：刻意的人還是能用完全站的匿名額度，但被擋下的回報會留在瀏覽器之後重送，登入後回報不受影響；要完全擋住得加 CAPTCHA（Edge Function 驗 Turnstile）。B3 提到 `prepare_report` 匿名計數沒有索引的問題，也因為改用計數表一起解決。

**10/25 修正（三）**：L1、L2 由 `20261025220000_display_name_rules.sql` 處理：暱稱擋控制字元、零寬字元、方向控制字元、頭尾空白（前端 `web/src/displayName.ts` 同一套規則）；加 `profiles.hidden`，Roger 在 Dashboard 設成 true 後別人在排行榜看不到他，他自己看得到；使用者只能更新 `display_name`（順便修掉 L4 的 `created_at`）；排行榜門檻參數不能低於預設值。同名沒擋：預設暱稱只有 65,536 種，要唯一得處理撞名，等真的有人冒充再說。

**10/25 修正（四）**：L5、B1 是前端的修正。L5：登出與刪除帳號移到 `web/src/account.ts`，先把各個紀錄的擁有者換成 anon 再整理 localStorage（解決 race）；登出時這個帳號在裝置上只留還沒同步的紀錄，連不上伺服器時改成只登出這台裝置（原本離線按登出沒有反應）；刪除帳號另外清掉裝置上的作答進度（目前這一回合、作答中的模擬考、看過的劇情、訊息、回報過的題目、學弟／學妹，清單在 `web/src/localData.ts`）。B1：作答紀錄改存精簡格式（`web/src/answerStorage.ts`，實測一筆從 158 字降到 65 字，可存約 7.5 萬筆），舊格式第一次讀到時自動轉換；存不進去時帳號旁邊顯示提示。資料庫拉下來的時間格式也統一了（原本混著 `Z` 和 `+00:00`，`messages.ts` 用字串比較時間會比錯）。以上用 Playwright 攔下所有 Supabase 請求實測過。

**10/25 修正（五）**：B2、B3。B2：作答改成增量同步，只拉 `synced_at` 比上次新的紀錄（往前多拉 5 分鐘），每天一次完整同步，正解更正後重新判分的結果才拉得到；游標存在 localStorage，登出、紀錄存不進瀏覽器時清掉；模擬考和送禮補上分頁（原本超過 1,000 筆會被截斷）。B3（`20261025230000_sync_and_leaderboard_perf.sql`）：加 `answers (user_id, synced_at)` 索引；連續天數改讀每人每天的題數表 `answer_days`（作答寫入、重新判分時由 trigger 維護，既有資料在 migration 時補算），不再掃全部作答；`question_keys` 加由題號算出來的 `paper_id` 與索引，模擬考算分不再掃整張正解表。`prepare_report` 的匿名計數已在修正（二）解決。週榜維持現算（只掃本週，有索引）；排行榜快取（materialized view）沒做，等人數多了再看。

**10/25 修正（六）**：B4–B7。B4（`20261025240000_report_owner.sql`、`web/src/reports.ts`）：回報時記下登入的帳號，送出時登入的不是他（或舊版沒記錄）就改成匿名送出；資料庫放寬成登入的人也能送匿名回報（`user_id` 還是不能填別人）。B5：沒有改掉自動併入（說明與邀請訊息都是這樣講的），登入時併進帳號後在帳號旁邊提示「已把這台裝置上沒登入時寫的 N 題併進帳號」，可以關掉。B6：在修正（四）的 L5 一起修了。B7：註解改掉。

**10/25 修正（七）**：L3。CSP 加在 build 出來的 `index.html`（`web/src/csp.ts`，由 `web/vite.config.ts` 加進去；開發伺服器不加）、SEO 靜態頁（不允許任何 script）和 `privacy.html`。script 只能來自自己和 Turnstile，連線只能到自己和 Supabase。用 Playwright 走過角色模式地圖與劇情、作答、聲音、題庫搜尋、排行榜、登入對話框（真的載入 Turnstile）、靜態頁，網站本身沒有違規；故意插入外部 script 會被擋下。`style-src` 保留 `'unsafe-inline'`：試過拿掉也正常，但沙盒連不到 Cloudflare 的驗證主機，Turnstile 互動驗證的流程沒辦法完整測。
`frame-ancestors` 不能用 `<meta>` 設定，GitHub Pages 又不能加 header，所以擋不了被別的網站用 iframe 嵌入（clickjacking）；刪除帳號要自己輸入「刪除」，影響有限。
共用 origin 沒辦法用程式解決：10/25 查過 `rogerh0711.github.io` 底下還有 `K-Map-Practice`、`Serenity_Tracker` 兩個網站，都是單一 HTML 檔、script 全部內嵌，沒有載入第三方 script，目前風險低。要徹底分開得換 origin（例如開一個 GitHub organization，網址變成 `<組織名>.github.io/nmle`，免費），但網址會變（Search Console、OAuth 的 Redirect URL、Turnstile 的主機名稱、朋友手上的連結都要改），等 Roger 決定；在那之前，同一個帳號底下的網站不要載入第三方 script、不要顯示別人提供的內容。

**10/25 上線**：5 個 migration 由 Roger `npm run db:push` 套用，確認線上舊版前端正常後合併 [RogerH0711/nmle#9](https://github.com/RogerH0711/nmle/pull/9)，GitHub Actions 部署成功；線上首頁有 CSP，Roger 實測帳號密碼登入（含 Turnstile）正常。

---

## 高

### H1　連續天數榜可以回填過去的日子

**事實（已重現）**

- `supabase/migrations/20261014000000_init.sql:57`：`answered_at timestamptz not null`，值由前端送，資料庫只用它。
- `supabase/migrations/20261015000000_leaderboard.sql:109-114`：`leaderboard_streaks` 只排除「晚於現在 5 分鐘」的紀錄，**沒有下限**。
- 作答一次 insert 可以帶很多筆（前端本來就一批 500 筆，`web/src/answers.ts:22`）。

**攻擊方式**：登入後在網站的 DevTools console 執行（publishable key 寫在前端，登入權杖在 localStorage）：

```js
const s = JSON.parse(localStorage['sb-gppcwxkhkzfogdfudebu-auth-token'])
const qs = (await (await fetch('questions/115090_1.json')).json()).questions.slice(0, 10)
const rows = []
for (let d = 0; d < 365; d++)
  for (const q of qs)
    rows.push({ id: crypto.randomUUID(), question_id: q.id, picked: q.answers[0], correct: true,
                answered_at: new Date(Date.now() - d * 864e5).toISOString() })
await fetch('https://gppcwxkhkzfogdfudebu.supabase.co/rest/v1/answers', {
  method: 'POST', body: JSON.stringify(rows),   // 3,650 筆，一次送出
  headers: { apikey: '<publishable key>', Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
})
```

PoC 結果：`leaderboard_streaks()` 回傳 `streak: 365`。

**建議修法**

1. 在 `grade_answer` trigger 裡把 `new.synced_at := now()`（不信任前端，見 L4），並拒絕太舊的作答，例如 `answered_at < now() - interval '3 days'`（保留離線作答幾天後才同步的空間）：
   ```sql
   if new.answered_at < now() - interval '3 days' or new.answered_at > now() + interval '5 minutes' then
     new.answered_at := now();   -- 或 raise exception；改成 now() 不會讓舊裝置的同步卡住
   end if;
   ```
   注意：同步舊紀錄的使用者（例如很久沒連網的裝置）會被影響。比較溫和的做法是收下，但另外存一個 `ranked boolean`，排行榜只算 `answered_at >= synced_at - interval '3 days'` 的紀錄。
2. 已經在線上的資料可以用 `answered_at < synced_at - interval '3 days'` 查有沒有人回填過（`synced_at` 目前前端也能改，所以這個查詢只能抓到沒刻意偽造的）。
3. 加對應的 PGlite 測試：回填 365 天的作答不能讓連續天數超過實際天數。

### H2　模擬考榜：「每份考卷只採計第一次」可以繞過

**事實（已重現）**

- `supabase/migrations/20261016000000_mock_exams.sql:13-18`：`started_at`、`submitted_at` 都由前端送，檢查只有「交卷 ≥ 開始」「不超過 2 小時 1 分」。
- 同檔 `:58-62`：「第一次」是用前端送的 `started_at` 排序決定的。
- 同檔 `:66`、`:81`、`:86`：秒數 = `submitted_at - started_at`，同分時秒數少的排前面。

**攻擊方式**：先正常考一次（考爛了），再 insert 一筆 `started_at = submitted_at = '2000-01-01'`、`picks` 填正解的紀錄。PoC 結果：同一份考卷的成績從 `score 1, seconds 3600` 變成 `score 100, seconds 0`，而且排在所有人前面。

**建議修法**

1. 用伺服器時間決定「第一次」：`order by m.user_id, m.paper_id, m.synced_at, m.id`，並在 insert trigger 強制 `synced_at := now()`。
2. 拒絕不合理的時間：`started_at` 不能早於 `now() - interval '2 hours 1 minute' - <離線寬限>`、`submitted_at <= now() + interval '5 minutes'`（目前只在排行榜查詢時過濾）。
3. 秒數不要當同分的排序依據，或設最低秒數（例如少於 10 分鐘不列入），因為這個數字完全由前端決定。

### H3　正解本來就公開，週榜正確率可以直接刷

**事實**：`question_keys` 的 RLS 是對的（沒有任何 policy，PGlite 測試與 PoC 都確認登入者、未登入者都讀不到、也改不了）。但正解在下面這些地方都能直接拿到，所以「前端拿不到正解」這件事不成立：

| 位置 | 內容 |
| --- | --- |
| `data/questions/*.json`（部署成 `questions/*.json`） | 每題的 `answers` 欄位，刷題時就會下載 |
| `web/src/staticPages.ts:111`、`:121-124`（部署成 `q/<考卷>/<題號>.html`，2,424 頁，sitemap 全部列出） | 「看正解」區塊 |
| `data/explanations/*.json` | 詳解第一行「**答案：C**」 |
| `supabase/seed/question_keys.sql`（公開 repo） | 2,400 題的完整正解表 |

這是設計上的選擇（作答後要馬上顯示正解、要支援離線、SEO 頁要給 Google 看），不是錯誤；但排行榜的可信度要另外處理：

- **照抄正解**：讀 `questions/*.json` 再作答，週榜 100%。PoC：`leaderboard_weekly` 回傳 `accuracy 100.0`。
- **不用作弊也能刷**：`leaderboard_weekly` 是「同一題同一天只算第一次」（`20261015000000_leaderboard.sql:78`），**隔天再做同一題會再算一次**。可出題的送分題有 23 題（任何答案都算對），每天做一輪，三天就有 69 題、正確率 100%、達到 50 題門檻。背 50 題每天重做也一樣。

**建議修法**（擇一或組合，取決於 Roger 想讓排行榜有多「認真」）：

1. 週榜改成「本週每題只算第一次作答」（不是每天），並排除 `free_point` 題目；這是最便宜、效果最大的修正。
2. 承認排行榜是朋友間的君子協定：在排行榜頁面寫明，並準備處理方式，例如 `profiles` 加 `hidden boolean`（只有 Dashboard 能改），排行榜函式排除 `hidden`。公開後遇到灌分可以直接在 Dashboard 處理，不用改程式。
3. 速率限制（例如每分鐘最多 60 題，見 M3）可以擋掉「一次塞 3,000 筆」，但擋不住照正解慢慢答。

---

## 中

### M1　任何登入者都能列出所有使用者

**事實（已重現）**：`supabase/migrations/20261014000000_init.sql:19-21`

```sql
create policy "登入者可以看到所有人的暱稱" on public.profiles for select to authenticated using (true);
```

帳號密碼註冊只要通過 Turnstile 就能拿到 `authenticated`，之後：

```js
await supabase.from('profiles').select('id, display_name, created_at')   // 全部使用者
```

PoC 回傳了所有人的 `id`、`display_name`、`created_at`。影響：

- 排行榜函式特別設計成「不回傳 user id」（`20261015000000_leaderboard.sql:63`），但這張表直接給了。
- design.md「暱稱不用真名」提到：**改版前就登入的使用者，暱稱仍是 Google 名稱**。這些人的真名對所有登入者公開。
- `data/privacy.html` 寫「資料庫設定為每個人只能讀寫自己的資料」，和實際不符。

前端只讀自己的暱稱（`web/src/supabase.ts:55-57`），排行榜函式是 `security definer`，不依賴這條 policy。

**建議修法**：policy 改成 `using (id = (select auth.uid()))`，加 PGlite 測試「看不到別人的暱稱」。另外在 Dashboard 查一次還在用 Google 名稱的人（`select id, display_name from profiles where display_name !~ '^同學[0-9A-F]{4}$'`），請他們改名或幫他們重設。

### M2　Google 帳號可以把 Email 改成任意地址

**事實（DB 層已重現）**：`supabase/migrations/20261025120000_username_login.sql:16-18` 只在 `raw_app_meta_data ->> 'provider' = 'email'` 時檢查格式。Google 註冊的使用者 `provider = 'google'`，PoC 把他的 Email 改成 `victim@gmail.com`，trigger 沒有擋。

**推論（未實測 GoTrue）**：線上關掉了「Confirm email」（`mailer_autoconfirm`），GoTrue 的 `PUT /user`（`supabase.auth.updateUser({ email })`）在 autoconfirm 時會直接套用新 Email，不寄確認信。如果是這樣，Google 使用者可以：

1. `updateUser({ email: 'someone@gmail.com' })` 佔用別人的真實 Email（正是這個 trigger 想擋的事）；
2. 再 `updateUser({ password })`，之後就能用 `signInWithPassword({ email: 'someone@gmail.com' })` 登入；
3. 也可以把 Email 改成 `xxx@users.invalid`，搶走還沒人註冊的帳號名稱。

如果真正的 `someone@gmail.com` 之後用 Google 登入，GoTrue 的自動帳號連結（同 Email 的已驗證身分）有機會把他連到攻擊者的帳號（account pre-hijacking）。這一步取決於 GoTrue 版本與設定，沒有驗證。

**建議修法**：trigger 對 `update` 不分 provider，Email 有變就擋（網站本來就沒有改 Email 的功能）：

```sql
if tg_op = 'UPDATE' and old.email is distinct from new.email then
  raise exception '不能修改 Email' using errcode = 'check_violation';
end if;
```

要注意 GoTrue 在 Google 登入時，若 Google 那邊的 Email 改了，可能也會更新 `auth.users.email`；可以放寬成「新 Email 必須等於這個使用者某個 `auth.identities` 的 Email」。另外在 Dashboard 確認「Secure email change」是開的。驗證方式：本機 `supabase start` 起完整的 GoTrue，用 Google 以外的 provider 模擬不了，可以直接在 SQL 改 `raw_app_meta_data` 為 google 後呼叫 `PUT /auth/v1/user`。

### M3　寫入沒有數量限制，可以塞滿資料庫

**事實**：

| 表／函式 | 誰能寫 | 限制 |
| --- | --- | --- |
| `answers`（`20261014000000_init.sql:69-71`） | 登入者 | 無 |
| `mock_exams`（`20261016000000_mock_exams.sql:37-39`） | 登入者 | 無（`picks` 最多約 100 鍵） |
| `gifts`（`20261020120000_gifts.sql:30-32`） | 登入者 | 無（「一天一次」只在前端檢查） |
| `reports`（`20261017000000_reports.sql:41-48`） | 任何人 | 每個 `device_id` 每分鐘 5 筆；`device_id` 由前端決定，換一個就重算。登入者沒有總量限制 |
| `ping_usage`（`20261020000000_usage.sql:24-47`） | 任何人，含未登入 | 無；每個新的 `device` 就新增一列 |

PoC：登入者換 30 個 `device_id` 連續回報 30 筆都成功（每筆 `note` 可以 500 字）。

Supabase 免費方案資料庫 500 MB，滿了會變唯讀；`answers` 一列約 150 bytes，一個帳號用迴圈一晚就能塞幾百萬列。PostgREST 本身沒有每個使用者的速率限制。另外 `answers` 越大，`leaderboard_streaks` 越慢（見 B3）。

**建議修法**：

1. 在 insert trigger 加每個使用者的速率限制，例如 `answers`：同一 `user_id` 最近 1 分鐘 `synced_at` 超過 300 筆就擋（要先做 L4 讓 `synced_at` 由伺服器決定；前端一次推 500 筆的批次也要配合調小，或改成每批限制）。`reports` 對登入者也加每小時上限。
2. `ping_usage` 可以限制每天新裝置數（超過就不新增，只更新既有的），或乾脆接受風險，但在 Dashboard 設好用量告警。
3. Dashboard → Settings → Usage 設定 email 告警，至少能早點發現。

### M4　匿名回報的全站額度可以被一個人用完

**事實（已重現）**：`supabase/migrations/20261017000000_reports.sql:45-48`，未登入的回報全站合計每小時 200 筆。攻擊者每小時用隨機 `device_id` 送 200 筆（每分鐘 5 筆 × 40 個 device），之後所有沒登入的人按「回報疑義」都會得到「目前匿名回報太多」。前端會把回報存在 localStorage 之後重送（`web/src/reports.ts:99-117`），所以不會遺失，但會一直送不出去。

另外 `device_id` 每分鐘 5 筆的限制擋不住任何刻意的濫用（migration 的註解也寫了）。兩個 `count(*)` 在並行請求時也可以同時通過（read committed）。

**建議修法**：這個機制的目的是防止被灌爆，現實上可以接受「被攻擊時匿名回報暫停」，但建議：

1. 匿名的總額度改成依 `question_id` 計（同一題每小時最多 N 筆），一個人灌爆只影響那幾題；
2. 或匿名回報加 Turnstile（打開回報對話框才載入，跟登入一樣），之後 Dashboard 再加 CAPTCHA 驗證要另外寫 Edge Function，成本較高；
3. 至少在 Dashboard 定期看 `reports` 的筆數。

### M5　登入相關的線上設定要逐項確認

**事實**：repo 裡只有 `supabase/config.toml`（本機用，CLAUDE.md 規定不能 `config push`），和線上設定可能不同：

- `config.toml:183`：`minimum_password_length = 6`；design.md「登入」寫「線上也要設最短 8 碼」。密碼長度只有前端 `web/src/login.ts:24-27` 檢查，直接呼叫 `POST /auth/v1/signup` 可以用 6 碼註冊，如果線上沒改。**10/25 Roger 確認線上已設 8 碼。**
- Turnstile 只有在 Dashboard 開啟「Enable Captcha protection」並填 secret key 時，GoTrue 才會在伺服器端驗證；前端送 token 本身不代表有驗證。如果沒開，直接打 API 就能繞過 Turnstile。**10/25 確認已開**：不帶 token 呼叫 `POST /auth/v1/token?grant_type=password`，回 `400 captcha_failed`（`request disallowed (no captcha_token found)`）。
- `config.toml:179` 的 `enable_anonymous_sign_ins = false` 是本機值；線上若開著，任何人不用 CAPTCHA 就能拿到 `authenticated`。

**建議**：照文末的「Dashboard 檢查清單」逐項確認，並把確認結果寫進 design.md「登入」。驗證 CAPTCHA 有開的方法：不帶 `captchaToken` 呼叫 `signInWithPassword`，應該回 `captcha_failed`。

---

## 低

### L1　暱稱沒有伺服器端的內容檢查

**事實（已重現）**：`profiles.display_name` 只檢查長度 1–30（`20261014000000_init.sql:13`）；前端會 `trim()`（`web/src/App.tsx:1173`），但直接呼叫 API 時 PoC 可以設成：

- `'   '`（純空白，排行榜上看起來是空的）；
- `'\u202Eabc'`（RTL override，讓暱稱顯示成反向文字，可以偽裝成別的字）、零寬字元；
- 和別人完全相同的暱稱（冒充排行榜上的某人）。

React 會把暱稱當文字輸出，**沒有 XSS**（排行榜 `web/src/Leaderboard.tsx:108`、`:146` 都是 `{r.display_name}`）。公開後主要的風險是不雅暱稱與冒充。

**建議修法**：check constraint 改成 `btrim(display_name) <> '' and display_name !~ '[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]'`；要不要唯一（`unique (lower(display_name))`）看 Roger 的意思。不雅暱稱用 M1 提到的 `hidden` 欄位在 Dashboard 處理。

### L2　排行榜門檻參數由前端決定

**事實**：`leaderboard_weekly(min_answers int)`、`leaderboard_streaks(min_daily int)`（`20261015000000_leaderboard.sql:67`、`:102`）的參數由前端傳（`web/src/supabase.ts:85`、`:91`）。呼叫 `leaderboard_streaks(1)` 就能看到每個「今天或昨天至少做 1 題」的人的暱稱與連續天數，比網站設計的公開程度多。`leaderboard_weekly(0)` 也會讓所有人顯示為 `qualified`。

**建議修法**：函式不收參數，門檻寫死在 SQL（前端的 `WEEKLY_MIN_ANSWERS`、`STREAK_MIN_DAILY` 改成只用來顯示說明）；或在函式裡 `greatest(min_daily, 10)`。

### L3　共用 origin、沒有 CSP（CSP 已加，共用 origin 待決定）

**事實**：

- 網站在 `https://rogerh0711.github.io/nmle/`，origin 是 `rogerh0711.github.io`。Supabase 的 session（含 refresh token）存在 localStorage（`web/src/supabase.ts:8-10`，`persistSession: true`）。**同一個 GitHub 帳號底下的其他 Pages 專案（`rogerh0711.github.io/<其他 repo>/`）都能讀到這個 localStorage**。既然要當履歷作品，之後如果用同一個帳號放別的 demo（尤其是載入第三方 script 的），就能偷到這裡的登入權杖。
- 沒有 Content-Security-Policy。目前沒有 XSS 的入口（見「已確認沒問題」），所以是縱深防禦。

**建議修法**：其他專案放在別的 GitHub 帳號或自訂網域；在 `web/index.html` 加 `<meta http-equiv="Content-Security-Policy">`，至少 `script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://gppcwxkhkzfogdfudebu.supabase.co; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'`（要在本機確認 Turnstile、Google 登入跳轉、音訊都還能用）。

### L4　`synced_at`、`created_at` 可以由前端決定

**事實（已重現）**：`answers.synced_at`、`mock_exams.synced_at`、`gifts.synced_at` 只有 `default now()`，insert 時前端可以自己帶值（PoC 寫入 `1990-01-01` 成功）；`profiles.created_at` 可以 update（PoC 改成 `1999-01-01` 成功）。目前沒有任何邏輯依賴這些欄位，但 H1、H2、M3 的修法都需要一個「伺服器決定的時間」。

另外 PoC 送 `graded: false`，trigger 會蓋掉成 `true`，這部分是對的。

**建議修法**：insert trigger 裡 `new.synced_at := now()`；`profiles` 的 update 用 column privilege 限制只能改 `display_name`：`revoke update on public.profiles from authenticated; grant update (display_name) on public.profiles to authenticated;`。

### L5　刪除帳號與登出後，裝置上還有資料

**事實**：

- 登出（`web/src/supabase.ts:32-34`）不清 `nmle.answers.v1.<user id>`、`nmle.mocks.v1.<user id>` 等紀錄；共用電腦（圖書館、宿舍）下一個人可以在 DevTools 看到前一個人的作答。
- 刪除帳號（`web/src/supabase.ts:40-51`）只清鍵名含 user id 的紀錄。`nmle.messages.v1`、看過的劇情、`nmle.reports.sent.v1`、目前這一回合（`RUN_KEY`）等沒有 user id 的紀錄會留著。隱私權政策說「這台裝置上這個帳號的紀錄也會一起清掉」，大致成立，但不完全。
- Race：`delete_my_account` 成功後、`signOut` 前，如果 `answers.ts` 的同步剛好在跑，`setState` 會把 `nmle.answers.v1.<user id>` 再寫回 localStorage（`web/src/answers.ts:57`）。`window.location.reload()` 只清記憶體。
- 刪除帳號不要求重新輸入密碼，只要輸入「刪除」。對這種網站可以接受。
- 刪除後，舊的 access token 在到期前（預設 1 小時）還能通過 JWT 驗證，但所有表都有外鍵指向 `auth.users`，寫不進去，沒有實際影響。

**建議修法**：`deleteAccount` 先 `signOut({ scope: 'local' })` 讓 `switchUser(null)` 停掉同步，再清 localStorage；或在清除後再清一次。登出時的清除是取捨（清掉就不能離線看之前的紀錄），至少在使用說明提醒共用電腦要用無痕模式。

### L6　帳號名稱可以列舉

**推論**：Confirm email 關閉時，用已存在的帳號名稱註冊，GoTrue 會回 `user_already_exists`（前端也依此顯示「這個帳號名稱已經有人用了」，`web/src/login.ts:45-47`）。有 Turnstile 擋大量嘗試，帳號名稱也不是公開資訊，風險低，記錄即可。

---

## 資訊

### I1　repo 裡的金鑰與個資

**事實**：

- 工作目錄與 67 個 commit 的歷史都掃過（`sb_secret_`、`service_role` JWT、`GOCSPX`、`hf_`、`ghp_`、`sk-`、`AKIA`、私鑰、`.env`），**沒有找到秘密金鑰**。gitignore 的 `NMLE_DE/`、`raw/`、`.venv*` 也從來沒進過 git 歷史。
- 公開的只有本來就該公開的：Supabase publishable key 與 project ref（`web/src/supabase.ts:5-6`、`supabase/README.md`）、Turnstile site key（`web/src/turnstile.ts:5`）、Google Search Console 驗證檔。
- **所有 commit 的作者 email 是學校信箱，帳號就是學號**（`f74146115@gs.ncku.edu.tw`）。plan.md 記錄 10/21 Roger 決定不改；公開到 Dcard 後，任何人 `git log` 都能看到學號與學校，等於網站和真實身分連在一起。若之後改主意，只能改之後的 commit（`git config user.email <GitHub noreply>`），改歷史要 force-push。
- `docs/design.md:221` 有陽明醫國考詳解作者群的公開聯絡信箱，是他們網站上公開的，沒問題；但 design.md 同一段寫了「學生詳解」的使用方式，公開前可以再讀一次，確認措辭是 Roger 願意讓作者群看到的。
- `docs/screenshots/` 的排行榜是虛構暱稱（plan.md 有寫），沒有真實使用者資料。

### I2　「送出後才向伺服器拿正解」已經沒有意義

`docs/design.md`「技術架構」與 plan.md「公開前要完成」都提到，公開前可能要改成作答後才向伺服器拿正解。因為正解已經在 SEO 靜態頁、題庫 JSON 和公開 repo 裡（H3），這個改法擋不到任何人，還會失去離線作答。建議把那段改成「正解是公開的，排行榜的防弊靠 H1–H3 的伺服器端規則」。

---

## Bug 與效能

### B1　localStorage 容量：重度使用者的紀錄會默默存不進去（中）（已修）

`web/src/answers.ts:36-42`：所有作答存成一個 JSON 陣列，每次作答都重新 `JSON.stringify` 整個陣列。一筆約 130 字元，瀏覽器的 localStorage 約 5M 字元，**大約 3.5–4 萬筆就存不進去**，`catch` 直接忽略。2,400 題刷 15 輪就到了（加上模擬考、送禮、訊息共用同一個額度會更早）。之後：

- 沒登入的人：重新整理後新的作答全部消失；
- 登入但離線的人：還沒同步的作答在重新整理後消失。

另外每作答一題就序列化整個陣列，筆數多時手機上會卡。**建議**：容量滿時顯示提示（現在完全沒有），長期改用 IndexedDB 或只在本機保留未同步與近期的紀錄。

### B2　每次同步都把全部作答紀錄重新下載（中）（已修）

`web/src/answers.ts:117-152`：登入、`online` 事件、按「重試」都會 `pullAll()`，每頁 1,000 筆依序抓。1 萬筆就是 10 個依序請求，每次換網路都重抓一次。**建議**：記住上次同步的 `synced_at`（先做 L4），只抓 `synced_at > 上次` 的紀錄。

`web/src/mockStore.ts:93`、`web/src/giftStore.ts:92` 的 select 沒有分頁，PostgREST 預設最多回 1,000 列（`supabase/config.toml:18`），超過會被默默截斷。送禮一天五位、一年就超過 1,000 筆，換裝置後書籤餘額和好感度會算錯（**低**，要很久才會發生）。

### B3　排行榜查詢會隨資料量變慢（中，公開後才會明顯）（已修，快取除外）

- `leaderboard_streaks`（`20261015000000_leaderboard.sql:109-114`）每次都掃**所有人有史以來全部的作答**，再 group by。沒有時間下限，索引幫不上。建議只看最近 N 天（例如 `answered_at > now() - interval '400 days'`），或另外存每人每天的題數。
- `leaderboard_mock`（`20261016000000_mock_exams.sql:69-74`）對每一筆模擬考用 `starts_with(k.question_id, ...)` 掃 `question_keys`，不能用主鍵索引，成本是「模擬考筆數 × 2,400」。建議 `question_keys` 加 `paper_id` 欄位與索引，或改成 `k.question_id like f.paper_id || '\_%'` 搭配 `text_pattern_ops` 索引。
- `prepare_report`（`20261017000000_reports.sql:45-46`）的匿名計數 `where user_id is null and created_at > ...` 沒有合適的索引（現有的是 `(status, created_at)`、`(device_id, created_at)`），表大了會全表掃描。
- 三個排行榜都是每次打開就現算，沒有快取。人數多時可以改成每 5 分鐘更新一次的 materialized view。

### B4　回報會算到「送出時」登入的人（低）（已修）

`web/src/reports.ts:105`：排隊中的回報在 flush 時才 insert，`user_id` 由資料庫 `default auth.uid()` 帶入。離線時以 A 帳號回報、之後換成 B 帳號登入才送出，回報就變成 B 的。影響很小，記錄即可。

### B5　共用裝置的匿名作答會併進下一個登入的帳號（低，設計取捨）（加了提示）

`web/src/answers.ts:101-108`：登入時把這台裝置上沒登入時的作答全部併進帳號。共用電腦上別人沒登入刷的題目，會變成下一個登入者的紀錄（也會影響他的排行榜）。可以在登入後提示「已併入 N 筆這台裝置上的紀錄」。

### B6　刪除帳號的 race（低）（已修）

見 L5。

### B7　過時的註解（極低）（已修）

`web/src/aiPrompt.ts:3` 與 `web/src/AskAi.tsx:15` 寫「網站沒有詳解」，10/22 起已有 AI 詳解。

---

## 已確認沒問題的部分

- **`question_keys`**：開了 RLS、沒有任何 policy，登入者、未登入者都讀不到也改不了；判分 trigger 會蓋掉前端送的 `correct` 與 `graded`（PGlite 測試與 PoC 都確認）。
- **每張表都開了 RLS**：`profiles`、`answers`、`question_keys`、`mock_exams`、`reports`、`usage_daily`、`gifts`。作答、模擬考、送禮都只能讀寫自己的，沒有 update／delete policy；`reports`、`usage_daily` 沒有人讀得到。未登入者只能 insert `reports` 與呼叫 `ping_usage`。
- **`security definer` 函式**都有 `set search_path = ''`，排行榜、刪除帳號都收回了 `anon` 的執行權限；`delete_my_account` 只能刪 `auth.uid()` 自己。
- **XSS**：整個 `web/src` 沒有 `dangerouslySetInnerHTML`、`innerHTML`、`eval`；詳解用自己寫的 parser 拆成區塊再用 React 輸出（`web/src/explanationText.ts`）；暱稱、台詞、題目都是 React 文字節點。SEO 靜態頁所有題目內容、詳解、標題都經過 `esc()`（`web/src/staticPages.ts:16-17`），屬性都用雙引號。`window.open` 有 `noopener`。
- **build 產物**：沒有 source map；`dist/` 只有 `data/` 的內容、靜態頁和 JS/CSS，沒有 repo 的其他檔案。正解在產物裡是設計使然（H3）。
- **登入流程**：Google 登入用 PKCE（`web/src/supabase.ts:9`），redirect 到別的網站拿到的 code 沒有 code verifier 也換不到 session；Turnstile 只在打開登入對話框時載入，token 每次失敗都 reset。
- **CI**：`permissions: contents: read`，部署權限只給 deploy job；PR 不部署。

---

## Dashboard 檢查清單（Roger 自己確認，不要用 `config push`）

Authentication：

- [x] Sign In / Providers → Email：「Confirm email」關閉（帳號密碼註冊要用）。
- [x] **Minimum password length = 8**（10/25 確認；`config.toml` 是本機用的 6，不影響線上）。
- [x] Sign In / Providers → Email：「Secure email change」開啟（M2 的補強，不能取代 trigger）。
- [x] Attack Protection：「Enable Captcha protection」開啟、provider 是 Turnstile、secret key 已填。驗證：不帶 `captchaToken` 呼叫 `signInWithPassword` 要回 `captcha_failed`（10/25 確認通過）。
- [x] Anonymous sign-ins 關閉；Phone、Magic link 等沒用到的 provider 關閉。
- [x] URL Configuration：Site URL 是 `https://rogerh0711.github.io/nmle/`；Redirect URLs 只有這個網址與本機開發用的 localhost，沒有 `https://*.github.io/**` 這類萬用字元。
- [x] Rate Limits：登入／註冊的每 IP 限制維持預設或更嚴（10/26 Roger 確認都是預設值）。

其他：

- [x] Supabase 帳號與 Google Cloud 帳號都開兩步驟驗證（design.md 有提到；10/26 Roger 確認，Google Cloud 用的是開了兩步驟驗證的個人 Google 帳號）。
- [x] Settings → Usage：設定資料庫空間告警（M3）。
- [x] Database → Roles／Data API：確認 `pg_graphql` 沒有額外開放（目前也受 RLS 保護，只是減少攻擊面；10/26 Roger 確認 extension 本來就是關閉的）。

---

## 修正建議的優先順序

1. **公開前一定要做**：H1、H2（伺服器時間＋拒絕回填）、H3 的第 1 點（週榜每題只算一次、排除送分題）、M1（profiles 只讀自己）、M2（擋 Email 修改）、M5 清單其餘項目。這些都是幾行 SQL 加 PGlite 測試，一個 migration 可以做完。
2. **公開後一週內**：M3（速率限制＋用量告警）、L1（暱稱檢查＋`hidden` 欄位）、L2、L4。
3. **有空再做**：B1–B3、L3 的 CSP、L5、M4。

---

## 附錄：PoC 摘要

在 PGlite 上（`supabase/tests/helpers.js` 的 `createDb` → 全部 migration → seed），以一般登入者身分執行：

```sql
-- H1：回填 365 天，每天 10 題
insert into public.answers (id, question_id, picked, correct, answered_at)
values (gen_random_uuid(), '110020_1_001', 'D', true, now() - interval '364 days'), ...;
select * from public.leaderboard_streaks();          -- streak = 365

-- H2：補一筆比真正第一次更早的模擬考
insert into public.mock_exams (id, paper_id, started_at, submitted_at, picks)
values (gen_random_uuid(), '115090_1', '2000-01-01', '2000-01-01', '{"115090_1_001":"…", …}');
select * from public.leaderboard_mock('115090_1');    -- score 100, seconds 0（原本 score 1, seconds 3600）

-- M1
select id, display_name, created_at from public.profiles;   -- 所有使用者

-- M2（以資料庫管理者身分模擬 GoTrue 的更新）
update auth.users set email = 'victim@gmail.com' where id = '<google 使用者>';  -- 沒有被 trigger 擋

-- L1、L4
update public.profiles set display_name = E'\u202Eabc', created_at = '1999-01-01' where id = auth.uid();
insert into public.answers (..., synced_at) values (..., '1990-01-01');           -- 照收
```

M3／M4：登入者用 30 個隨機 `device_id` 連續 insert `reports` 全部成功；未登入者送滿 200 筆後，任何人的匿名回報都回「目前匿名回報太多」。
