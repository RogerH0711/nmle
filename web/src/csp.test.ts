// CSP 有沒有涵蓋程式實際連到的外部服務。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APP_CSP, STATIC_PAGE_CSP, SUPABASE_ORIGIN, TURNSTILE_ORIGIN } from './csp.ts'

const src = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf-8')

test('CSP 的 Supabase、Turnstile 網址和程式裡用的一樣（換專案時兩邊都要改）', () => {
  assert.ok(src('./supabase.ts').includes(`'${SUPABASE_ORIGIN}'`), 'supabase.ts 的 SUPABASE_URL 和 csp.ts 不一致')
  assert.ok(src('./turnstile.ts').includes(`${TURNSTILE_ORIGIN}/`), 'turnstile.ts 的 script 網址和 csp.ts 不一致')
})

test('網站的 CSP：script 只能來自自己和 Turnstile，不能 inline、不能 eval', () => {
  const script = APP_CSP.split('; ').find((d) => d.startsWith('script-src'))!
  assert.equal(script, `script-src 'self' ${TURNSTILE_ORIGIN}`)
  assert.ok(APP_CSP.includes("object-src 'none'"))
})

test('靜態頁的 CSP 不允許任何 script', () => {
  assert.ok(STATIC_PAGE_CSP.startsWith("default-src 'none'"))
  assert.ok(!STATIC_PAGE_CSP.includes('script-src'))
})
