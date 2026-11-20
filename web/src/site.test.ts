// 網站網址只寫在 site.ts（改進清單第 15 項）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { SITE } from './site.ts'

const web = new URL('../', import.meta.url)
const list = (dir: string, pattern: RegExp) =>
  readdirSync(new URL(dir, web), { recursive: true })
    .map((f) => `${dir}${String(f).replaceAll('\\', '/')}`)
    .filter((f) => pattern.test(f))

test('正式網址只寫在 site.ts：搬網域時只改一處', () => {
  const files = [
    ...list('src/', /\.(ts|tsx|css)$/).filter((f) => f !== 'src/site.ts'),
    ...list('scripts/', /\.ts$/),
    'index.html',
    'vite.config.ts',
    ...list('../data/', /^\.\.\/data\/[^/]+\.html$/), // privacy.html、Search Console 驗證檔
  ]
  const host = new URL(SITE).host
  assert.deepEqual(files.filter((f) => readFileSync(new URL(f, web), 'utf-8').includes(host)), [])
  // 分享預覽的網址由 vite.config.ts 在 build 時代換
  assert.match(readFileSync(new URL('index.html', web), 'utf-8'), /<meta property="og:url" content="__SITE__" \/>/)
})
