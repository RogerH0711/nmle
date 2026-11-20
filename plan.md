# 醫師一階刷題 galgame：目前狀態與待辦

最後更新：2026-11-20

開工只讀這份。各功能怎麼做、為什麼這樣決定、過去的回饋都在 `docs/design.md`（需要時查對應段落）；角色與台詞在 `characters.md`。

**更新方式**：做完一段，在這裡改狀態、刪掉做完的待辦；做法和理由寫進 `docs/design.md` 對應的段落。這份保持在一兩頁以內，不寫細節。

## 目前狀態

網址：https://rogerh0711.github.io/nmle/ 。10/18 起已有幾位朋友在用（邀請訊息 `docs/invite.md`），進入「邊用邊收回饋」的階段。

已完成（細節見 `docs/design.md` 括號內的段落）：

- 題庫：105–115 年 42 份考卷、4,199 題可出題（11/20 加入 105–109 年，網站還沒部署），人工修正 32 題；CI 會抽檢題庫（「題庫處理流程」）。105–109 年還沒有詳解。
- 刷題、錯題複習（Leitner）、模擬考、排行榜三種、伺服器判斷對錯、Google 登入與離線同步（「遊戲設計」「技術架構」）。
- 五位學姊的立繪與台詞、好感度與各五段劇情、吃醋、九張劇情背景、校園地圖首頁、能力值面板、學姊傳訊息、劇情畫面改版（「遊戲設計」「遊戲介面方向」）。
- 使用說明、回報疑義、免責聲明、問 AI 按鈕、學弟／學妹稱呼、匿名使用統計（「詳解與題目正確率」「專案概要」）。
- 公開前的 security review（10/25，`reports/security-review.md`）：排行榜防偽造、寫入數量上限、暱稱規則與排行榜隱藏、登出與刪除帳號清理本機資料、作答紀錄精簡格式與增量同步、CSP 都已上線（5 個 migration 已 `db:push`，前端已部署，Roger 實測登入正常）（「技術架構」）。
- 台詞擴充（10/20）：每位學姊加 23 句熟識以後才出現的當面台詞（回合開始、答對、答錯、結束、連對、久沒上線），每位約 72 句。
- 聲音（10/20）：音效、BGM、語音的播放與設定，預設靜音；BGM 已上線，配音做完顏緋（「美術與內容」的「聲音」）。
- 禮物商店（10/20）：書籤由作答紀錄推算，送禮稍微推進熟識、在意（「獎勵與商店」）。
- 服裝立繪（10/21–22，本機 3070，`art/outfits.py`）：劇情服裝兩套（溫芷薰「心動」浴衣、夏以晴「告白前夕」田徑服，已接到劇情的 `outfit` 欄位）、沈靜澄「心動」沒戴眼鏡的表情、服裝商店用的造型十套（每位私服一套、依個性一套），都含表情差分與去背；參數記在 `characters.md`「定稿紀錄」。
- 服裝商店（10/22）：和禮物同一個商店畫面，私服 300 書籤（熟識）、造型 600 書籤（在意），劇情服裝看完劇情免費；買了說一句反應台詞並換上，不加好感度；換上的服裝用在劇情以外的畫面（「獎勵與商店」）。
- 封面與遊戲名稱（10/22–25）：「醫師一階攻略～五位學姊陪你考過～」，封面 `data/cover.webp`（Logo 在圖上），用在網站開頭畫面、分享預覽（`data/cover-og.jpg`）、README（「美術與內容」的「封面」）。11/19 照 Roger 的意思換成 Animagine 畫風重畫（構圖不變、人站近、靜澄的書移到胸前，`art/cover_restyle.py`），還在修改，Roger 說定案之前不換 `data/` 的封面（11/19 曾先換上又還原）。11/19 白袍半透明、識別證被擋已修；補手 4 個 seed、光線 A／B／後製的對照圖（`art/bakeoff/cover/restyle/hand_sheet.jpg`、`light_AB_sheet.jpg`、`light_AB_zoom.jpg`、`light_post_zoom.jpg`）等 Roger 挑，挑完再重跑 closer → restyle → recolor → upscale → faces。
- 詳解（10/20–22，Colab 上的 Qwen 3.6 27B）：2,360 題生成、比對、名詞檢查，衝突題重新生成後換進 95 題；網站分級顯示，已比對 70.3%，10/22 上線（「詳解與題目正確率」，流程見 `pipeline/explain/README.md`）。

## 待辦

**全面檢查（11/16，`reports/improvement-review.md`）**：49 項建議，照報告的「處理順序」做，狀態記在報告開頭的表。11/16 完成第一到第三組：多分頁合併、返回鍵、備份與搬家、按鈕對比、圖示與 PWA（離線）、ErrorBoundary、對話框焦點（細節在 `docs/design.md`「技術架構」），以及 oxlint、測試檔型別檢查、e2e 進 CI、App.tsx 拆出四個元件和 `run.ts`。11/20 做了第四組的不確定清單、收藏、筆記（圖書館的三個清單，雲端同步，第 25、26 項）。還沒 commit、部署。部署後要在手機上實際試返回鍵和「加到主畫面」。11/20 次主題（第 27 項）：83 個定案（`docs/subtopics.md`），網站接好了；`NMLE 詳解批次` 正在跑 35B 分類（約 3 小時），跑完自動匯出 `data/subtopics.json`，Claude 每科抽查後再 commit。

**Claude（依序）**

1. 台詞與劇情改寫（10/25 同學回報「AI 感很重」）：規則在 `characters.md`「台詞寫法」。挑台詞的程式已改（好感度上限、`rare`、知識台詞對題目關鍵字，`web/src/lineRules.ts`）；10/25 五位的台詞都改完、知識台詞都加了 `keywords`；劇情改了顏緋五段；11/06 其他四位的劇情也照同樣的規則改寫（去掉格言、旁白替角色解釋心情、寫死的數字、程式無法確認的事；夏以晴補上「放慢腳步等你」的角色主題），大綱、背景、服裝不變。等 Roger 和同學看過，再決定要不要繼續調整。
2. 聲音的音檔：配音先做顏緋。11/14 顏緋 64 句完成，換成 Breeze TTS 2（分段念 seg v2，參考聲音 B_s1；Roger：「有 80 分了」，比 BreezyVoice 好），網站底部、`privacy.html`、README 標了出處與非商業授權。做法：`art/voice_breeze2.py` 念（每句 6～42 次）、`art/voice_prosody.py` 對齊各段音量、`art/voice_check.py breezy` 辨識、`art/voice_export.py` 挑（念錯 0 才自動上線，辨識判斷不了的用 `art/voice_pick.py` 給 Roger 挑，記在 `PICK`）。11/15 顏緋劇情 37 句也配好（旁白、玩家不配；劇情台詞加了 id，`Story.tsx` 播放），每句 Roger 用互動挑選頁（`art/voice_server.py`）聽過挑的。11/18–19 收禮台詞（有 `{gift}` 的兩句 × 15 種禮物）重念：方向是語氣指示（台灣腔、謝謝拖長、整句同一個情緒）＋「東西」寫成「東希」＋整句併成一段，Roger 挑的特點記在 `docs/design.md`「收禮台詞念禮物名稱」。11/19 30 句 × 6 次念完（`breeze2-seg-B_s1-v4blv`）；Roger 挑到一半改成前後半分開挑再接（`art/voice_gift_splice.py`，後半句加「欸～」「喔～」），挑選頁 `fei-gift-split-pick.html`，接好、他說換上才匯出到 `data/audio`。下一步：其他四位（要先挑參考聲音）。細節見 `docs/design.md`「Breeze TTS 2 評估」。BGM：11/06 七首定案並接進網站（ACE-Step 1.5，`art/bgm.py` 生成、`art/bgm_loop.py` 切循環點與壓 mp3，出處已標在頁尾、`privacy.html`、README）；Roger 聽過接縫（溫芷薰改用另一組循環點），11/06 上線（「美術與內容」的「聲音」）。
3. 題庫瀏覽、搜尋、選項打亂、SEO（做法見 `docs/design.md`「題庫瀏覽與搜尋」）：
   1. ~~瀏覽頁與關鍵字搜尋~~（10/25 完成，`web/src/QuestionBank.tsx`，網址 `#/bank/...`）。10/25 使用說明加了「題庫」一節和打亂選項的說明（`Guide.tsx`）；還沒給朋友試用。
   2. ~~選項打亂~~（10/25 完成，`web/src/options.ts`；不打亂的只有一題多解等 43 題）。
   3. ~~SEO 靜態頁~~（10/25 完成，build 時產生 `q/` 底下 2,424 頁與 `sitemap.xml`）。10/25 Roger 已在 Search Console 驗證（`data/google329b5f494802031d.html`，不能刪）、提交 sitemap、要求總覽頁建立索引，等收錄；幾天後 sitemap 還是「無法擷取」再查。10/25 每題頁加了 schema.org JSON-LD（`Quiz` + 選擇題 `Question`，含正解）；Google 的 Education Q&A 只收 Flashcard、不支援中文，目前不會有複合式搜尋結果（理由見 `docs/design.md`「公開與作品集」的 SEO）。
   4. ~~同義詞與上位概念~~（11/06 完成，搜「抗生素」找得到 gentamicin；`data/search/`，做法見 `docs/design.md`「題庫瀏覽與搜尋」）。分類表是 Claude 手整理的，11/06 Roger 看過。
4. 依朋友回饋調整好感度門檻（`web/src/affection.ts` 的 `GOALS`，等有實際升階速度的資料；10/25 Roger：之後再說）；書籤賺法與禮物價格也一起看（`shop.ts` 的 `EARN`、`data/gifts.json`）。
5. 封面畫質（11/19 Roger：「畫質有點低」，全部弄好之後再處理）：用 Real-ESRGAN ncnn-vulkan，做法和 Roger 的經驗記在 `docs/design.md`「封面」的「畫風重畫」。
6. 劇情 CG：要先用定稿立繪訓練每位學姊的 LoRA（10/22 Roger：之後再做，A100 的運算單元剩不多）。
7. **105–109 年詳解（11/20 14:50 開始）**：排程批次「NMLE 詳解批次」用本機 `qwen3.5:35b-a3b` 開 thinking 生成（27B 本機要 18 天，Roger 改用 35B，原因與品質比較見 `docs/design.md`「105–109 年」），約 4.5 天，速度和預估完成時間看 `progress.log`。這批不比對（沒有學生詳解），網站標「未經比對」。跑完再跑名詞檢查、`export_web.py`（模型名稱標 Qwen3.5-35B-A3B），另外 11/20 補了 4 科次主題的範圍說明，詳解跑完、GPU 空下來後要跑 `classify.py run all` 和 `export`（只重分改到的學科，約 70 分鐘；目前這輪批次啟動得比較早，不會自動跑），重分後抽查再 commit `data/subtopics.json`。
8. 名詞判斷改用已修正的擷取規則（10/22 改好 `terms.py`）：不單獨重跑。10/25 算過新規則多抓出 393 組名詞（202 題，部分是舊名詞加上英數前綴），27B 在 3070 上估要 1–1.5 天（沒有 A100 了）；效益小，等生成 105–109 年的詳解時一起跑（11/20 題目已解析好，詳解還沒生成）。

**Roger**

- 11/20 `db:push` 完成：`question_marks`（收藏與筆記）和 105–109 年的正解 seed。這次前端先部署、資料庫後推（migration 和前端兩邊相容，中間只是同步失敗、作答不判分）。推之前發現 Supabase 專案因為 7 天沒活動被暫停，網站的登入、同步、排行榜停了一段時間；恢復步驟寫在 `supabase/README.md`「專案被暫停時」。預防：Roger 決定加排程，`.github/workflows/keepalive.yml` 每天三次查一次資料庫（官方文件的判定方式與限制寫在該檔開頭）；push 之後要到 Actions 手動跑一次確認。
- 10/25 改版通知已發；台詞改版、音檔做完再發一次。
- 看過五位學姊的劇本、調整語氣（10/25：之後再說）。

**等 Roger 決定**

- 什麼時候切換到 `nmle.me`（公告至少要先掛幾天，切換後舊網址會被 GitHub 直接轉走）。

**10/20 已決定**

- 3070 筆電的 GPU 環境：`.venv-gpu/`（Python 3.14、PyTorch 2.14.1 + CUDA 13.0，已測過 GPU 可用，不進 repo）；本地 LLM 用 Windows 版 Ollama 跑 `qwen3.5:9b`（WSL 裡的舊 Ollama 已停用）。
- 網域：~~維持 `rogerh0711.github.io/nmle`~~ 11/05 改為公開前搬到自訂網域（學生方案的免費網域），一次解決 security review L3（同帳號的 `K-Map-Practice`、`Serenity_Tracker` 讀得到登入權杖）。要長期續約，過期會被別人註冊走。朋友的資料：搬家前一週在舊網站公告「請先登入保存紀錄」，不做跨網域交接頁（有登入的人只會掉穿哪套服裝、看過的劇情、訊息、稱呼、設定）。
- 去背模型 `bria-rmbg`（rembg 下載的是 RMBG-2.0，CC BY-NC 4.0）：在 README／網站標示出處，網站維持不收費；要商業化時再換模型或買授權。

## 公開前要完成

確認朋友真的會用、題庫錯誤修得差不多之後才公開（Dcard）。理由見 `docs/design.md`「公開與作品集」。

- [x] 自訂暱稱
- [x] 伺服器判斷對錯（基本版）；10/25 決定不改成作答後才拿正解（正解本來就公開），改用排行榜防偽造規則（見「技術架構」）
- [x] 回報疑義按鈕和免責聲明
- [ ] Google 登入發布：OAuth 用戶端已在個人帳號（10/21 Roger 確認），剩「發布應用程式」（可能要驗證品牌和網域）
- [x] 支援信箱：10/25 Roger 決定維持學校信箱，不開專案 Gmail（理由見「風險」表）
- [x] 標示去背模型出處：頁尾與 `privacy.html` 的「出處與授權」（10/21）
- [x] 隱私權政策和使用條款頁：`data/privacy.html`（獨立網址，給 Google 發布應用程式填；10/21 草稿，等 Roger 看過）。聯絡方式用 GitHub Issues
- [x] 使用者自己刪除帳號（10/21，migration 要 Roger `npm run db:push`）
- [x] README：架構圖、技術重點與取捨（10/21）；LICENSE 用 MIT（只涵蓋程式碼）；遊戲畫面截圖（10/22，`docs/screenshots/`：本機網站塞示範作答紀錄、攔下所有 Supabase 請求，排行榜是虛構暱稱；介面大改時重拍）
- [x] commit 作者 email（學校信箱）：10/21 Roger 決定維持不改，也不改寫歷史
- [x] 登入對話框說明 Google 登入拿到什麼，另外提供不用 Email 的帳號密碼（10/25 上線，Roger 實測註冊、登入、登出、刪除帳號都正常）
- [x] 帳號密碼登入加 CAPTCHA（Cloudflare Turnstile，10/25）
- [x] security review 的發現（10/25 修正並上線，`reports/security-review.md`）；L6（帳號名稱可以被試出來）只記錄不修
- [x] security review 的 Dashboard 檢查清單（10/26 Roger 確認完成，報告最後）：Confirm email 關閉、Secure email change 開啟、Anonymous sign-ins 關閉、Redirect URLs 只留自己的網址、設定用量告警（Settings → Usage）
- [x] 題庫抽檢進 CI（10/25，`web/src/questionBank.test.ts`，跟著 `npm test` 跑；第一次跑抓到 2 題 override 混進看不見的控制字元，已修正）
- [ ] 搬到自訂網域 `nmle.me`（security review L3；11/05 Roger 已註冊）：舊網站公告請先登入 → 改網址、手動設 DNS、GitHub 驗證網域、`nmle` repo 設自訂網域 → 更新 Supabase、Google OAuth、Turnstile、Search Console、朋友的連結。注意事項見 `docs/design.md`「技術架構」的自訂網域
- [ ] 確認 Dcard 醫師版板規
- [ ] 寄信給陽明醫國考詳解的作者群，說明我們拿詳解來比對（見「詳解與題目正確率」）

## 里程碑

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| 0. 題庫 pipeline 雛形 | 解析一份考卷；可作答的單頁網站 | 完成（10/14） |
| 1. 題庫與核心功能 | 近年考卷全部解析；自動檢查與抽查；Google 登入與同步；錯題複習 | 完成（10/14） |
| 2. 排行榜與角色 | 排行榜、模擬考；角色立繪與台詞；角色模式開關；手機版 | 完成（10/15） |
| **關卡：朋友開始使用** | 10/21，開始累積使用數據 | 10/18 起陸續開始 |
| 3. 完整遊戲 | 五位角色、好感度劇情、禮物與服裝商店（完成）；BGM 與配音、劇情 CG | 進行中 |
| 4. 公開與作品集 | 上面「公開前要完成」 | 朋友用 1–2 個月後 |
| **關卡：醫師一階考試** | 116 年 7 月或 117 年 1 月 | |

## 開工時注意

- 改 pipeline 後重跑 `pipeline/build_exam.py --years 110 115`，確認每份考卷的自動檢查都通過，並和改之前的輸出比對差異；正解有變動就重跑 `pipeline/export_keys.py`，再請 Roger 執行 `npm run db:push`。
- 資料庫變更：`supabase/migrations/` 新檔案加 `supabase/tests/` 的測試（`npm run test:db`），每張新表開 RLS；推送後從外部測一次未登入的讀寫。流程見 `supabase/README.md`。
- push 到 main 後 GitHub Actions 先跑測試，沒過不部署。
- 有 migration 的 PR：合併前先在 branch 上 `npm run db:push`，確認線上舊版前端正常再合併（合併就會自動部署前端；新版前端如果依賴新的資料庫規則，順序反了會出錯）。所以 migration 要寫成和舊版前端相容。
