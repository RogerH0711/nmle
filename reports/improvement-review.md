# 全面檢查與改進建議

日期：2026-11-16　檢查：Claude Fable 5.2　處理：Claude Opus 5.5

## 範圍與限制

- **讀過**：`plan.md`、`docs/design.md`（技術架構、公開與作品集）、`reports/security-review.md`、前端主幹（`App.tsx`、`answers.ts`、`audio.ts`、`search.ts`、`Story.tsx`、`MockExam.tsx`、`QuestionBank.tsx`、`affection.ts`、`shop.ts` 等）、主要 migration、CI、pipeline 結構。
- **實際執行**：`npm test`（128 個全過）、`npm run build`（成功，`dist` 50 MB）。
- **沒有細看**：`styles.css` 逐條、`art/` 腳本、詳解 pipeline、台詞的醫學內容、線上網站與 Supabase Dashboard。
- 10/25 security review 已處理的項目不重複。「事實」是看過程式或執行結果，「推論」是沒實測。

## 處理順序與狀態

| 順序 | 項目 | 狀態 |
| --- | --- | --- |
| 1 | 1、2、3、8（掉資料、搬網域相關） | 1、2、3 已做（11/16）；8 等 Roger |
| 2 | 5、6、7、13、24（公開時的第一印象） | 已做（11/16）；第 7 項的線上錯誤回報沒做 |
| 3 | 9–12（重構與工具） | 10–12 已做；9 做了第一步（11/16） |
| 4 | 25、26、27，再看回饋決定 28–31 | 25、26 已做；27 分類批次在跑（11/20） |

每項做完在這裡改狀態，細節寫進 `docs/design.md` 對應段落。

---

## 一、最優先（會掉資料，或公開後馬上被看到）

### 1. 多分頁會互相覆蓋作答紀錄（事實）

- **問題**：`web/src` 沒有監聽 `storage` 事件。每個分頁各自把記憶體裡的整份紀錄寫回同一個 localStorage 鍵：A 分頁作答後再到 B 分頁作答，B 會蓋掉 A 的紀錄。沒登入的人重新整理就不見。模擬考、送禮、看過的劇情、訊息也一樣。
- **位置**：`answers.ts`、`mockStore.ts`、`giftStore.ts`、`stories.ts`（`saveSeen`）、`messages.ts`（`saveMessages`）、`reports.ts`（已回報的題目）。
- **做法**：紀錄類（有 id、只增不改）監聽 `storage` 事件，把別的分頁寫入的紀錄依 id 合併進記憶體；集合類（看過的劇情、訊息、已回報）寫入前先和儲存的內容合併。
- **驗收**：兩個分頁輪流作答，重新整理後兩邊的作答都在；合併邏輯有單元測試。
- **狀態**：已做（11/16）。`web/src/merge.ts` 合併紀錄，三個紀錄 store 監聽 `storage`，劇情、訊息、已回報寫入前合併。**還沒處理**：登出時另一個仍開著的分頁，之後作答可能把已同步的紀錄寫回這台裝置（共用電腦的隱私問題，影響小）。

### 2. 手機的返回鍵會直接離開網站（事實）

- **問題**：沒有 `pushState`／`popstate`，只有題庫用 hash。看劇情、開商店、進排行榜時按返回，整個網站就關掉，在 Dcard 的 in-app browser 尤其明顯。
- **做法**：對話框、劇情、排行榜／模擬考／題庫畫面、題目畫面（角色模式）打開時推一筆 history；按返回關掉最上層那個，用介面關掉時把那筆退掉。
- **驗收**：手機上打開劇情、商店、排行榜後按返回，回到上一個畫面而不是離開網站；用介面關掉後再按返回，不會多退一層。
- **狀態**：已做（11/16）。`web/src/backStack.ts` 與 `useBack`。

### 3. 沒登入的人搬到 `nmle.me` 會全部歸零

- **問題**：localStorage 綁 origin，換網域後讀不到。目前的對策只有公告請大家先登入。帳號密碼使用者忘記密碼也無法重設，沒有任何備份手段。
- **做法**：使用說明加「備份與搬家」：把這台裝置的紀錄下載成 JSON 檔，在新網址匯入時和現有紀錄合併（作答、模擬考、送禮依 id 合併，不覆蓋），設定只在沒有時補上。不帶登入權杖、裝置代碼、使用統計。
- **驗收**：匯出後清掉 localStorage 再匯入，作答、好感度、書籤、看過的劇情都回來；重複匯入不會重複計算。
- **狀態**：已做（11/16）。`web/src/backup.ts`、`Guide.tsx`。搬網域的公告要記得提這個功能。

### 4. 雲端資料沒有備份（推論）

- **問題**：Supabase 免費方案不含備份。登出時會清掉裝置上已同步的紀錄，所以登入使用者的唯一副本在 Supabase。
- **做法**：寫一個 Roger 自己定期執行的 `pg_dump` 指令（或 `supabase db dump --data-only`），記在 `supabase/README.md`，dump 檔不進 repo。

### 5. 主要按鈕的對比不足（事實）
- **狀態**：已做（11/16）。`--accent-strong`（#b8561a，4.79:1）；角色色底的白字用 `color-mix` 加深 25%。

- **問題**：`styles.css` 的 `.primary` 是白字配 `#e8772e`，對比約 2.95:1，WCAG AA 要 4.5:1。靜態頁已經用較深的 `#c85f1c`。
- **做法**：按鈕底色加深（或改深色字），淺色、深色模式都量過。

### 6. 沒有 favicon、web manifest、`theme-color`（事實）
- **狀態**：已做（11/16），和第 24 項一起。圖示由 `art/icons.py` 產生。

- 分頁和加到主畫面都是預設圖示，作為履歷作品很顯眼。可以和第 24 項一起做。

### 7. 沒有 ErrorBoundary（事實）
- **狀態**：畫面部分已做（11/16，`web/src/ErrorBoundary.tsx`）；線上錯誤回報（RPC）沒做。

- 任何 render 例外都是整頁白屏，而且 Roger 不會知道。
- **做法**：最外層加 ErrorBoundary，顯示「出錯了」、重新整理按鈕和可複製的錯誤訊息。想知道線上錯誤，可以比照 `ping_usage` 做一個有上限的 `report_error` RPC（不接第三方、不動 CSP；要加 migration 與測試）。

### 8. 26 個修改和大量音檔還沒 commit

- 兩台電腦只靠 git 交接，這是目前最大的單點風險。commit、push 由 Roger 決定與執行。

## 二、前端架構與程式品質

### 9. `App.tsx` 太大

**狀態**：第一步已做（11/16）：`AccountMenu.tsx`、`QuestionCard.tsx`、`Summary.tsx`、`Disclaimer.tsx` 搬出去，回合的純函式搬到 `run.ts` 並補測試（`run.test.ts`），App 從 1,459 行降到 1,052 行。還沒做：`useRun`／`useMockSession`／`useMessages` 這些 hook（`pick`、`go` 仍在 App 裡）。

1,459 行、約 35 個 `useState`，回合、模擬考、訊息、商店、聲音、路由全在一個元件，`pick`／`go`／`startRun` 這些核心流程因此沒有測試。建議抽成 `useRun`（或 reducer）、`useMockSession`、`useMessages`，再把 `QuestionCard`、`Summary`、`Account` 搬出去。

### 10. 沒有 ESLint

**狀態**：已做（11/16）。typescript-eslint 還不支援 TypeScript 7，改用 oxlint（`web/.oxlintrc.json`，`npm run lint`，CI 會跑）。開了 hooks 的兩條規則；React Compiler 那組（refs、immutability、set-state-in-effect）誤報多，關掉。修了 `Story.tsx` 一個少列的依賴、未用的 import、`story.then` 改名 `afterwards`（物件有 `then` 會被當成 Promise）。

`web/package.json` 沒有 eslint，卻有 7 個 `eslint-disable-next-line react-hooks/exhaustive-deps`，這些 effect 的依賴沒人檢查。裝 `eslint-plugin-react-hooks` 並進 CI。

### 11. 測試檔沒有型別檢查

**狀態**：已做（11/16）。`web/tsconfig.test.json`、`npm run typecheck`，CI 會跑。原本就沒有型別錯誤。

`web/tsconfig.json` 排除 `*.test.ts`，Node 執行時只去掉型別。加一個含測試的 tsconfig，在 CI 跑 `tsc --noEmit`。

### 12. 沒有自動化的 e2e

**狀態**：已做（11/16）。`web/e2e/smoke.test.ts`（7 個測試：多分頁、返回鍵、角色模式返回、對話框焦點、備份、離線、CSP 與例外），CI 在 build 之後跑。本機 `E2E_CHANNEL=msedge npm run e2e`。

CLAUDE.md 寫了「開發伺服器沒有 CSP，本機測不出來」。加一個 Playwright smoke test 進 CI：build 後開 `vite preview`，作答一題、開劇情、開題庫，斷言主控台沒有 CSP 違規。

### 13. 對話框的鍵盤與螢幕閱讀器支援
**狀態**：已做（11/16，`web/src/dialog.ts`）。沒有改用 `<dialog>`（top layer 會打亂現有的疊放），改成共用 hook：焦點移入、Tab 循環、Esc 只關最上層、關閉後還原焦點、`aria-modal`。


七個對話框各自寫 Escape 處理，沒有 focus trap、`aria-modal`、關閉後還原焦點。改用原生 `<dialog>` 的 `showModal()` 一次解決，並刪掉重複的程式。

### 14. `window.alert／confirm／prompt`

共 5 處。刪除帳號用 `prompt` 輸入「刪除」，在部分 in-app browser 會被擋。換成自己的對話框。

### 15. 網站網址寫死在三處

`web/index.html`、`staticPages.ts` 的 `SITE`、README。搬網域前先集中成一個設定。

### 16. 每次作答都重算全部紀錄

`save()` 重新編碼整份紀錄，好感度對五位角色各排序一次，`answeredToday` 每次 render 都掃全部。上萬筆在手機上可能會卡（推論）。改成增量寫入與快取。

### 17. 好感度第 4 階的模擬考比對方式

`affection.ts` 用「作答時間等於交卷時間」找模擬考的題目，依賴時間戳完全相等。改用模擬考紀錄的 `picks` 算。

## 三、效能與載入

### 18. 每次部署所有資料檔都重新下載

`bank.ts` 的 `?v=` 用 commit，改一行 CSS 也要重抓 13 MB 音檔和全部立繪。build 時產生每個檔案的內容雜湊表，只有變動的檔案換網址。

### 19. BGM 解碼後永久留在記憶體

`audio.ts` 的 `buffers` 不清除。每首 67–91 秒，解碼後約 25–32 MB，七首聽過一輪約 190 MB（估算），手機 Safari 可能直接殺掉分頁。BGM 只保留目前這首。

### 20. 「和學姊讀書」第一次會載入全部 24 份考卷

**狀態**：已做（11/20，加入 105–109 年後變成 42 份）。先用學科區段抽題號，只載入抽到的考卷（`run.ts` 的 `subjectQuestionIds`、`pickRound`）。

`App.tsx` 的 `beginCharacterRun`（未壓縮約 1.9 MB）。在 pipeline 產生每個學科的題號清單，只載需要的考卷，或在地圖閒置時預先載入。

### 21. 圖片沒有寬高、立繪表情沒有預載

0 個 `<img>` 有 `width`。第一次換表情會閃，版面會跳。回合開始時預載那位學姊的全部表情。

### 22. Supabase 套件一開始就載入

gzip 55 KB，對沒登入的多數人也一開始就載入。可以改成有 session 或打開登入對話框才動態載入，`ping_usage` 改用 `fetch`。效益中等、複雜度不低，排後面。

### 23. 自訂網域後考慮前面加 Cloudflare

能設真正的 HTTP header（`frame-ancestors`、雜湊檔的長快取），解掉 security review 裡「擋不了 iframe」。憑證與 Pages 設定要小心，先評估。

## 四、離線與 PWA

### 24. README 寫「離線可用」，但沒有 service worker
**狀態**：已做（11/16）。`vite-plugin-pwa` 2.0.0；預先快取網站程式，資料用到時快取。實測離線重新整理還打得開。


實際上是「已經開著的頁面斷線還能作答」，離線時打不開網站。用 `vite-plugin-pwa`：預先快取程式，題庫用過再快取，順便解決第 6、18 項，通勤族也能加到主畫面。沒做之前 README 的說法要改準確。

## 五、學習功能

25. **「不確定」按鈕**：猜對的題目永遠不會回來。作答後加「這題是猜的」，放進 Leitner 第一格。**已做（11/20）**：照 Roger 的提議做成圖書館裡另一個清單（不混進 Leitner），再答一次就移出。
26. **收藏題目與個人筆記**：目前沒有（「書籤」是貨幣，命名要避開）。**已做（11/20）**：☆ 收藏、筆記，雲端同步（`question_marks`，要 `db:push`）。
27. **學科分類全部是粗分**：2,400 題的 `subject_status` 都是 `range`。用本機 Qwen 逐題分類並標次主題，能力值就能細到「心血管藥理」。**11/20**：學科分界人工看過 42 份考卷，不逐題重分；次主題 83 個（`docs/subtopics.md`）已定案，35B 分類批次在跑，網站的能力值、題庫、題目標籤都接好了。
28. **高頻考點頁**：用 `data/search/concepts.json` 統計每個概念六年出了幾題，做成「常考排行」，也是 SEO 入口。
29. **全站各題正確率**：每晚彙總成靜態 JSON，作答後顯示「43% 的人答對」；正確率異常低的題目可能是解析或答案錯了。
30. **考試倒數與每日目標**。
31. **模擬考隨機組卷**：依正式考試的學科比例抽 100 題（不列榜）；記每題花的時間。
32. **一般模式沒有能力值入口**。
33. **那 1 題不能出題的題目**（選項缺漏）寫 override 補上。**11/20 看過**：114020_1 #77 的四個選項是化學結構圖，題庫的選項只能放文字，維持不出題。
34. **118 題「衝突」、303 題「未比對」的詳解**：依回報數和答錯率排序，優先人工看或重新生成。

## 六、新手流程與成效數據

35. **第一次進站要過三關**：封面、使用說明、選稱呼。先量測流失再決定要不要縮短。
36. **使用統計只有「裝置 × 天 × 題數」**：多記幾個匿名計數（到達的最高階段、看過幾段劇情、有沒有開過商店和題庫、有沒有開聲音），才能調好感度門檻；留存與複習完成率的 SQL 現在就寫好。
37. **成績分享圖**：模擬考成績或連續天數用 canvas 畫成圖，貼 Dcard 或限動。

## 七、SEO

38. 搬到 `nmle.me` 後加 `data/robots.txt`（含 `Sitemap:`）。
39. `index.html` 的 `#root` 裡放一段靜態介紹和「歷屆試題總覽」連結，React 掛上去後會取代。
40. 每題靜態頁加「同概念的其他題目」。

## 八、資料庫與 CI

41. 加測試自動檢查 public 的每張表都開了 RLS（現在靠人記）。
42. pipeline 沒有測試、`requirements.txt` 沒鎖版本：鎖版本，並挑十幾題難解析的題目做 pytest 固定比對。**11/20**：版本已鎖（PyMuPDF 1.28.2 重跑 110–115 年和 repo 一致）；pytest 還沒做。
43. 在 `exams.json` 記每份原始 PDF 的 SHA-256。
44. 加 `.github/dependabot.yml`。
45. 用 `supabase gen types` 產生型別，取代 `as WeeklyRow[]`（Roger 執行）。

## 九、文件與 repo

46. `plan.md` 違反自己的「一兩頁、不寫細節」：待辦第 2 項的配音流程搬到 design.md。
47. `art/` 加簡短 README 標明現役流程，其餘移到 `art/archive/`。
48. 音檔每位定案後才 commit 一次，不要中途反覆覆蓋（repo 會永久變大）。
49. README 加「數字」段落與 30 秒操作 GIF。

## 需要 Roger 確認

- 配音的參考聲音 `B_s1` 是誰的聲音？如果是真人錄音，公開前要確認有權使用。
- Breeze TTS 2 和 RMBG-2.0 都是非商業授權，之後若放廣告或收贊助，兩個都要換。
