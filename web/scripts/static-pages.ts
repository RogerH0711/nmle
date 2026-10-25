// build 後產生 SEO 靜態頁：dist/q/index.html、每份考卷 dist/q/<考卷>.html、每題 dist/q/<考卷>/<題號>.html，
// 以及 dist/sitemap.xml。HTML 的內容在 src/staticPages.ts。執行：npm run build（vite build 之後自動跑）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExamFile, Index } from '../src/types.ts'
import { indexPage, paperPage, paperPath, questionPage, questionPath, sitemap, STYLE, type ExplanationData } from '../src/staticPages.ts'

const data = new URL('../../data/', import.meta.url)
const dist = new URL('../dist/', import.meta.url)
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, data), 'utf-8'))

function write(path: string, html: string) {
  const file = new URL(path, dist)
  mkdirSync(dirname(fileURLToPath(file)), { recursive: true })
  writeFileSync(file, html)
}

if (!existsSync(dist)) throw new Error('找不到 dist/，先跑 vite build')

const index = read<Index>('index.json')
const paths = ['', 'q/index.html']
write('q/index.html', indexPage(index))
write('q/style.css', STYLE)

for (const p of index.papers) {
  const file = read<ExamFile>(p.file)
  const expFile = new URL(`explanations/${p.id}.json`, data)
  const exp = existsSync(expFile) ? (JSON.parse(readFileSync(expFile, 'utf-8')) as ExplanationData) : undefined
  write(paperPath(p.id), paperPage(file, p, index))
  paths.push(paperPath(p.id))
  const qs = file.questions.filter((q) => q.valid)
  qs.forEach((q, i) => {
    write(questionPath(q), questionPage(q, p, index, exp, qs[i - 1], qs[i + 1]))
    paths.push(questionPath(q))
  })
}

writeFileSync(new URL('sitemap.xml', dist), sitemap(paths))
console.log(`靜態頁：${paths.length - 1} 頁，sitemap.xml 共 ${paths.length} 個網址`)
