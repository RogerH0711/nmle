// SEO 靜態頁的 HTML（不依賴瀏覽器環境）。build 後由 scripts/static-pages.ts 寫進 dist/q/。
// 網站本體是單頁應用，Google 看到的幾乎是空白頁；這些頁面把題目、正解、詳解直接寫在 HTML 裡，
// 讓搜「某藥名 醫師國考」的人找得到，再點進網站刷題。做法見 docs/design.md「公開與作品集」的 SEO。
import type { ExamFile, Index, PaperInfo, Question } from './types.ts'
import { LEVELS, parseExplanation, type ExplanationLevel } from './explanationText.ts'

export const SITE = 'https://rogerh0711.github.io/nmle/'
const NAME = '醫師一階攻略'
const LETTERS = ['A', 'B', 'C', 'D']

export interface ExplanationData {
  model: string
  questions: Record<string, { text: string; level: ExplanationLevel }>
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 一行摘要：去掉多餘空白，太長就截斷 */
function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

// 和 web/src/bank.ts 的 paperLabel 一樣（那邊會讀 import.meta.env，Node 載入不了）
export const paperLabel = (p: PaperInfo) => `${p.year} 年${p.session ? `第 ${p.session} 次` : ''} ${p.paper}`

export const paperPath = (paperId: string) => `q/${paperId}.html`
export const questionPath = (q: Question) => `q/${q.id.slice(0, q.id.lastIndexOf('_'))}/${q.number}.html`

// 所有靜態頁共用，寫成 q/style.css
export const STYLE = `
:root{--bg:#f6f4f1;--card:#fff;--text:#22201d;--muted:#6f6a63;--line:#e4dfd8;--accent:#c85f1c;--right-bg:#e6f4ea;--right:#2f8a4f}
@media (prefers-color-scheme:dark){:root{--bg:#1a1917;--card:#24221f;--text:#ece8e2;--muted:#a39d94;--line:#3a3733;--accent:#f0a46a;--right-bg:#1f3427;--right:#6cc58b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI','Noto Sans TC','Microsoft JhengHei',sans-serif;line-height:1.7}
.wrap{max-width:760px;margin:0 auto;padding:12px 16px 40px}
a{color:var(--accent)}
nav.crumb{font-size:.85rem;color:var(--muted);margin-bottom:8px}
h1{font-size:1.2rem;margin:4px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.tag{font-size:.75rem;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.stem{font-size:1.05rem;white-space:pre-wrap}
img{max-width:100%;background:#fff;border-radius:6px}
ol.opts{list-style:none;padding:0;margin:0 0 12px}
ol.opts li{display:flex;gap:8px;padding:4px 6px}
.key{flex:none;width:22px;height:22px;margin-top:3px;display:grid;place-items:center;border-radius:50%;background:var(--line);font-size:.8rem;font-weight:600}
details{border-top:1px solid var(--line);padding:8px 0}
summary{cursor:pointer;font-weight:600}
.answer{color:var(--right);font-weight:600}
.muted{color:var(--muted);font-size:.85rem}
.cta{display:inline-block;margin:8px 0;padding:8px 14px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
.pager{display:flex;justify-content:space-between;gap:8px;margin:12px 0}
ul.list{list-style:none;padding:0;margin:0}
ul.list li{padding:8px 0;border-bottom:1px solid var(--line)}
footer{margin-top:24px;font-size:.8rem;color:var(--muted)}
`

function page(opts: { title: string; description: string; path: string; body: string }) {
  const root = '../'.repeat(opts.path.split('/').length - 1) // 回到網站根目錄的相對路徑
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${SITE}${opts.path}">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE}${opts.path}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:image" content="${SITE}cover-og.jpg">
<link rel="stylesheet" href="{root}q/style.css">
</head>
<body>
<div class="wrap">
${opts.body}
<footer>
<p>非官方題庫。試題與答案取自考選部公開的歷屆試題，正解以考選部公告（含更正答案）為準。題目由程式從 PDF 解析，可能有誤，發現問題請到網站上按「回報疑義」。詳解由 AI 生成，沒有經過人工審核，和課本或官方答案不同時以課本與考選部為準。</p>
<p><a href="{root}">${NAME}</a>：用歷屆試題刷題、錯題複習、模擬考，免費，不登入也能用。</p>
</footer>
</div>
</body>
</html>
`.replaceAll('{root}', root)
}

function explanationHtml(exp: ExplanationData | undefined, q: Question) {
  const item = exp?.questions[String(q.number)]
  if (!exp || !item) return ''
  const blocks = parseExplanation(item.text)
    .map((b) => {
      const inner = b.parts.map((p) => (p.bold ? `<strong>${esc(p.text)}</strong>` : esc(p.text))).join('')
      return b.kind === 'heading' ? `<h3>${inner}</h3>` : `<p>${inner}</p>`
    })
    .join('\n')
  const level = LEVELS[item.level]
  return `<details>
<summary>看詳解（AI 生成・${esc(level.label)}）</summary>
<p class="muted">${esc(level.note)}</p>
${blocks}
<p class="muted">由 ${esc(exp.model)} 生成，沒有經過人工審核。</p>
</details>`
}

export function questionPage(q: Question, p: PaperInfo, index: Index, exp: ExplanationData | undefined, prev?: Question, next?: Question) {
  const label = paperLabel(p)
  const subject = q.subject ? index.subjects[q.subject] : null
  const heading = `${label} 第 ${q.number} 題`
  const answer = q.free_point ? '本題官方一律給分。' : `正解：${q.answers.join('、')}`
  const body = `<nav class="crumb"><a href="{root}">${NAME}</a> › <a href="{root}q/index.html">歷屆試題</a> › <a href="{root}${paperPath(p.id)}">${esc(label)}</a></nav>
<h1>醫師一階 ${esc(heading)}</h1>
<article class="card">
<p>${subject ? `<span class="tag">${esc(subject)}</span>` : ''}</p>
<p class="stem">${esc(q.stem)}</p>
${q.images.map((src) => `<p><img src="{root}${esc(src)}" alt="第 ${q.number} 題附圖" loading="lazy"></p>`).join('\n')}
<ol class="opts">
${q.options.map((o, i) => `<li><span class="key">${LETTERS[i]}</span><span>${esc(o)}</span></li>`).join('\n')}
</ol>
<details>
<summary>看正解</summary>
<p class="answer">${answer}${q.answer_note && !q.free_point ? `（${esc(q.answer_note)}）` : ''}</p>
</details>
${explanationHtml(exp, q)}
</article>
<div class="pager">
<span>${prev ? `<a href="{root}${questionPath(prev)}">← 第 ${prev.number} 題</a>` : ''}</span>
<span>${next ? `<a href="{root}${questionPath(next)}">第 ${next.number} 題 →</a>` : ''}</span>
</div>
<a class="cta" href="{root}#/bank/${p.id}/${q.number}">在網站上看這題、刷整份考卷</a>`
  return page({
    title: `${clip(q.stem, 32)}｜醫師一階 ${heading}`,
    description: clip(`${heading}${subject ? `（${subject}）` : ''}：${q.stem} ${q.options.map((o, i) => `(${LETTERS[i]}) ${o}`).join(' ')}`, 150),
    path: questionPath(q),
    body,
  })
}

export function paperPage(file: ExamFile, p: PaperInfo, index: Index) {
  const label = paperLabel(p)
  const qs = file.questions.filter((q) => q.valid)
  const body = `<nav class="crumb"><a href="{root}">${NAME}</a> › <a href="{root}q/index.html">歷屆試題</a></nav>
<h1>醫師一階 ${esc(label)} 歷屆試題</h1>
<p>共 ${qs.length} 題，點題目看選項、正解和 AI 詳解。</p>
<a class="cta" href="{root}#/bank/${p.id}">在網站上刷這份考卷</a>
<ul class="list card">
${qs
  .map((q) => {
    const subject = q.subject ? index.subjects[q.subject] : null
    return `<li><a href="{root}${questionPath(q)}">第 ${q.number} 題</a>${subject ? ` <span class="tag">${esc(subject)}</span>` : ''}<br>${esc(clip(q.stem, 80))}</li>`
  })
  .join('\n')}
</ul>`
  return page({
    title: `醫師一階 ${label} 歷屆試題與詳解｜${NAME}`,
    description: `考選部醫師第一階段考試 ${label} 全部 ${qs.length} 題，含正解與 AI 詳解，可以直接在網站上刷題。`,
    path: paperPath(p.id),
    body,
  })
}

export function indexPage(index: Index) {
  const years = [...new Set(index.papers.map((p) => p.year))].sort((a, b) => b - a)
  const body = `<nav class="crumb"><a href="{root}">${NAME}</a></nav>
<h1>醫師一階歷屆試題（${years[years.length - 1]}–${years[0]} 年）</h1>
<p>考選部醫師第一階段考試歷屆試題，每題都有正解，多數附 AI 詳解。想刷題、錯題複習、模擬考，到<a href="{root}">網站</a>上做。</p>
${years
  .map(
    (y) => `<section class="card"><h2>${y} 年</h2><ul class="list">
${index.papers
  .filter((p) => p.year === y)
  .map((p) => `<li><a href="{root}${paperPath(p.id)}">${esc(paperLabel(p))}</a> <span class="muted">${p.count} 題</span></li>`)
  .join('\n')}
</ul></section>`,
  )
  .join('\n')}`
  return page({
    title: `醫師一階歷屆試題與詳解（${years[years.length - 1]}–${years[0]} 年）｜${NAME}`,
    description: `考選部醫師第一階段考試 ${years[years.length - 1]}–${years[0]} 年歷屆試題，依年度與考卷瀏覽，含正解與 AI 詳解。`,
    path: 'q/index.html',
    body,
  })
}

export function sitemap(paths: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${SITE}${esc(p)}</loc></url>`).join('\n')}
</urlset>
`
}
