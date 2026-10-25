# 醫師一階刷題 galgame

用考選部歷屆醫師一階考題刷題的網站，各科由一位角色陪讀，朋友之間有排行榜。之後打算公開（Dcard）並當作履歷作品。

- 目前狀態、待辦、里程碑：`plan.md`（開工只讀這份，做完一段記得更新狀態）
- 設計與決策紀錄：`docs/design.md`（各功能的做法、理由、過去的回饋；需要時才查，做法有變就更新對應段落）
- 角色設定、台詞規則、立繪流程：`characters.md`
- 資料庫與 Supabase CLI：`supabase/README.md`

Roger 會在兩台電腦之間切換（家裡 Windows、外出 Mac），交接只靠 git：換電腦前 commit、push，開工先 `git pull`。對話紀錄不會跟著走，重要決定要寫進 repo 的文件。

## 結構

- `pipeline/`：Python，解析考選部 PDF。產出 `data/questions/`、`data/images/`、`data/index.json`，以及 `supabase/seed/question_keys.sql`。手動修正放 `pipeline/overrides/`，不要直接改產出的 JSON。
- `data/`：網站的靜態資料（題庫、角色、台詞、立繪），Vite 的 `publicDir`。
- `web/`：Vite + React + TypeScript 前端，部署到 GitHub Pages。
- `supabase/`：migration、正解 seed、PGlite 資料庫測試。
- `art/portraits.ipynb`：Colab 立繪 notebook（Animagine XL 4.0）。`art/backgrounds.ipynb`：劇情背景，同一個模型。

## 指令

Node 版本固定在 `.node-version`（CI 也讀這個檔）。兩台電腦都用 [fnm](https://github.com/Schniz/fnm) 管理：`fnm install` 後，shell 設定加上 `fnm env --use-on-cd`，進專案資料夾就會自動切換版本。Mac 不要用 `brew install node@24`，Homebrew 的 openssl 別名 bug 會讓安裝自己卡住。

```bash
npm ci && npm ci --prefix web       # 第一次 clone 後
npm --prefix web run dev            # 本機網站 http://localhost:5173
npm test                            # 資料庫測試 + 前端測試
npm run build --prefix web          # 型別檢查 + build
```

解析考卷（需要 Python 虛擬環境與 `pipeline/requirements.txt`）：

```bash
python pipeline/build_exam.py --years 110 115
python pipeline/export_keys.py      # 題庫變動後重新產生正解 seed
```

push 到 main 會由 GitHub Actions 跑測試，通過才部署。

## 規則

- **金鑰**：OAuth Client Secret、Supabase service_role key、資料庫密碼、HF token 都不能交給 Claude、不能進 repo。前端只用 publishable key。
- **Supabase**：`npx supabase login`、`link`、`npm run db:push` 由 Roger 自己在終端機執行。**不要執行 `supabase config push`**，它會覆蓋線上的登入設定。
- **資料庫變更**：新增 migration 要同時在 `supabase/tests/` 加測試；每張表都要開 RLS。判斷對錯用的正解放在 `question_keys`，前端讀不到這張表，對錯由資料庫算；正解本身是公開的（題庫 JSON、SEO 靜態頁），排行榜防偽造靠伺服器端規則（見 `docs/design.md`「技術架構」）。
- **git**：Roger 說了才 commit、push。commit 訊息用中文寫，說明做了什麼。
- **語言**：介面、文件、註解都用繁體中文（台灣用語）。
- **台詞**：台詞中的醫學內容要正確，寫完要核對。角色都是成年人。
- **考題資料**：正解以考選部答案與更正答案為準。疑似解析錯誤的題目寫 override，並寫明原因。
- **CSP**：網站連到新的外部服務（script、API、iframe）要加進 `web/src/csp.ts`，否則上線後會被瀏覽器擋下（開發伺服器沒有 CSP，本機測不出來，要 `npm run build --prefix web` 後用 `vite preview` 測）。
