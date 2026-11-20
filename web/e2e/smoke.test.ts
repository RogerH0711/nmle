// 端對端 smoke test：開 build 後的網站（vite preview），用真的瀏覽器走過幾個容易壞、單元測試測不到的地方。
// 開發伺服器沒有 CSP、沒有 service worker，所以一定要對 build 的結果測。
//
// 執行：npm run build && npm run e2e（CI 在 build 之後跑）
// 瀏覽器：CI 用 Playwright 下載的 Chromium（npx playwright install chromium）；
// 本機沒有下載的話可以用系統的 Edge 或 Chrome：E2E_CHANNEL=msedge npm run e2e（PowerShell：$env:E2E_CHANNEL='msedge'; npm run e2e）
//
// Supabase 和 Turnstile 的請求全部擋掉：測的是沒登入的使用情境，不碰線上資料庫。
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview, type PreviewServer } from 'vite'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

const PORT = 4174
const SITE = `http://localhost:${PORT}/`
let server: PreviewServer
let browser: Browser
const problems: string[] = [] // 所有頁面的 CSP 違規、未處理的例外和原生對話框，最後一起檢查

before(async () => {
  server = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { port: PORT, strictPort: true }, logLevel: 'warn' })
  browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {})
})

after(async () => {
  await browser?.close()
  await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()))
})

/** 新的瀏覽器環境（乾淨的 localStorage、沒有 service worker）。characterMode：角色模式；預設關掉，直接是題目畫面 */
async function newContext({ characterMode = false, mobile = false } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 } } : {})
  await ctx.route(/supabase\.co|challenges\.cloudflare\.com/, (r) => r.abort())
  await ctx.addInitScript((mode: boolean) => {
    if (location.protocol === 'about:') return
    sessionStorage.setItem('nmle.title.seen.v1', '1') // 跳過封面
    localStorage.setItem('nmle.guide.seen.v1', '1') // 跳過第一次的說明
    localStorage.setItem('nmle.player.v1', '學弟')
    if (localStorage.getItem('nmle.characterMode') === null) localStorage.setItem('nmle.characterMode', mode ? '1' : '0')
  }, characterMode)
  return ctx
}

async function open(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) problems.push(`CSP：${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`例外：${e.message}`))
  // 原生的 confirm／alert／prompt 在 App 內建的瀏覽器可能被擋，網站一律用 ConfirmDialog.tsx
  page.on('dialog', (d) => {
    problems.push(`原生對話框：${d.message()}`)
    void d.dismiss()
  })
  await page.goto(SITE)
  return page
}

const answerCount = (page: Page) =>
  page.evaluate(() => (localStorage.getItem('nmle.answers.v2.anon') ?? '').split('\n').filter(Boolean).length)

async function waitForCount(page: Page, n: number) {
  await page.waitForFunction((n) => (localStorage.getItem('nmle.answers.v2.anon') ?? '').split('\n').filter(Boolean).length === n, n)
}

test('作答會存起來；兩個分頁輪流作答不會互相蓋掉', async () => {
  const ctx = await newContext()
  const a = await open(ctx)
  const b = await open(ctx)
  await a.locator('button.option').first().click()
  await waitForCount(a, 1)
  await b.locator('button.option').first().click()
  await waitForCount(b, 2)
  await a.getByRole('button', { name: '下一題 →' }).click()
  await a.locator('button.option').first().click()
  await waitForCount(a, 3) // A 存檔時帶著 B 的那一筆
  await ctx.close()
})

test('返回鍵：關掉排行榜、說明，不會離開網站', async () => {
  const ctx = await newContext()
  const page = await open(ctx)
  await page.locator('button.option').first().waitFor()
  await page.getByRole('button', { name: '排行榜' }).click()
  await page.locator('.board').waitFor()
  await page.goBack()
  await page.locator('.board').waitFor({ state: 'detached' })
  assert.ok(page.url().startsWith(SITE))

  // 用按鈕關掉的那一層，history 要退掉：之後按返回關的是下一層
  await page.getByRole('button', { name: '說明' }).click()
  await page.getByRole('button', { name: '開始讀書' }).click()
  await page.getByRole('button', { name: '排行榜' }).click()
  await page.getByRole('button', { name: '說明' }).click()
  await page.locator('.guide').waitFor()
  await page.goBack()
  await page.locator('.guide').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.board').count(), 1)
  await page.goBack()
  await page.locator('.board').waitFor({ state: 'detached' })
  assert.ok(page.url().startsWith(SITE))
  await ctx.close()
})

test('角色模式：劇情、題目畫面按返回都回到上一層', async () => {
  const ctx = await newContext({ characterMode: true, mobile: true })
  const page = await open(ctx)
  await page.locator('.pin, .spot-main').first().click()
  await page.locator('.story').waitFor() // 第一次和她讀書，先播初識劇情
  await page.goBack()
  await page.locator('.story').waitFor({ state: 'detached' })
  await page.locator('button.option').first().waitFor() // 劇情看完（跳過）就開始讀書
  await page.goBack()
  await page.locator('.pin, .spot-main').first().waitFor()
  assert.ok(page.url().startsWith(SITE))
  await ctx.close()
})

test('對話框：焦點移進去、Tab 不跑出去、Esc 關掉後焦點回到按鈕', async () => {
  const ctx = await newContext()
  const page = await open(ctx)
  await page.locator('button.option').first().waitFor()
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))
  await page.getByRole('button', { name: '說明' }).focus()
  await page.keyboard.press('Enter')
  await page.locator('.guide').waitFor()
  assert.ok(await inDialog(), '打開後焦點在對話框裡')
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab')
    assert.ok(await inDialog(), `Tab 第 ${i + 1} 次跑出對話框`)
  }
  await page.keyboard.press('Escape')
  await page.locator('.guide').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '說明')
  await ctx.close()
})

test('備份：匯入會合併，重複匯入不會重複計算', async () => {
  const ctx = await newContext()
  const page = await open(ctx)
  await page.locator('button.option').first().click()
  await waitForCount(page, 1)
  const data = await page.evaluate(() => {
    const out: Record<string, string> = {}
    for (const k of Object.keys(localStorage)) if (k.startsWith('nmle.')) out[k] = localStorage.getItem(k) ?? ''
    return out
  })
  data['nmle.answers.v2.anon'] += '\nbbbbbbbb-0000-4000-8000-000000000009,115090_1_001,A,1,mhzz0000,0'
  data['nmle.story.seen.v1'] = '["fei-0"]'
  const file = join(mkdtempSync(join(tmpdir(), 'nmle-e2e-')), 'backup.json')
  writeFileSync(file, JSON.stringify({ app: 'nmle', version: 1, exported_at: new Date().toISOString(), data }))

  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: '說明' }).click()
    await page.getByRole('tab', { name: '帳號與聲音' }).click()
    const reloaded = page.waitForEvent('load')
    await page.locator('.backup-import input').setInputFiles(file)
    await page.getByRole('alertdialog').getByRole('button', { name: '匯入' }).click()
    await reloaded
    assert.equal(await answerCount(page), 2, `第 ${round + 1} 次匯入後`)
  }
  assert.match((await page.evaluate(() => localStorage.getItem('nmle.story.seen.v1'))) ?? '', /fei-0/)
  await ctx.close()
})

test('離線：打開過的網站重新整理還能作答', async () => {
  const ctx = await newContext()
  const page = await open(ctx)
  await page.locator('button.option').first().waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload() // 讓 service worker 接手，這次載入的題庫才會進快取
  await page.locator('button.option').first().waitFor()
  await page.waitForFunction(() => caches.keys().then(async (keys) => {
    for (const k of keys) if ((await (await caches.open(k)).keys()).some((r) => r.url.includes('/questions/'))) return true
    return false
  }))
  await ctx.setOffline(true)
  await page.reload()
  await page.locator('button.option').first().waitFor({ timeout: 10_000 })
  await ctx.close()
})

test('收藏、筆記；圖書館的不確定清單再答一次就移出', async () => {
  const marks = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('nmle.marks.v1.anon') ?? '{}'))
  const ctx = await newContext()
  const page = await open(ctx)
  await page.getByRole('button', { name: '收藏這題' }).click()
  await page.locator('button.option').first().click()
  await page.getByRole('button', { name: '寫筆記' }).click()
  await page.getByRole('textbox', { name: '這題的筆記' }).fill('  記得看圖  ')
  await page.getByRole('button', { name: '下一題 →' }).focus() // 離開輸入框就存
  const [[id, m]] = Object.entries(await marks(page)) as [string, { favorite: boolean; note: string }][]
  assert.deepEqual([m.favorite, m.note], [true, '記得看圖'])
  await page.reload()
  await page.getByRole('button', { name: '取消收藏' }).waitFor() // 重新整理後還在
  await ctx.close()

  // 角色模式：圖書館 → 不確定清單（先放一題進去）→ 作答後移出
  const ctx2 = await newContext({ characterMode: true })
  await ctx2.addInitScript((qid: string) => {
    if (location.protocol === 'about:' || localStorage.getItem('nmle.marks.v1.anon')) return
    localStorage.setItem('nmle.marks.v1.anon', JSON.stringify({ [qid]: { favorite: false, unsure: true, note: null, updated_at: new Date().toISOString(), synced: false } }))
  }, id)
  const map = await open(ctx2)
  await map.locator('.pin-review, .spot-review .spot-main').first().click()
  await map.locator('.library').waitFor()
  await map.goBack() // 返回鍵關掉圖書館
  await map.locator('.library').waitFor({ state: 'detached' })
  await map.locator('.pin-review, .spot-review .spot-main').first().click()
  await map.locator('.library li').nth(1).getByRole('button', { name: '開始' }).click()
  await map.locator('button.option').first().click()
  assert.equal((await marks(map))[id].unsure, false)
  await map.getByRole('button', { name: /加入不確定清單/ }).or(map.locator('.feedback.bad')).first().waitFor()
  await ctx2.close()
})

test('陪讀時先預載她的全部表情：第一次換表情不會空白一下', async () => {
  const ctx = await newContext({ characterMode: true })
  const page = await open(ctx)
  await page.locator('.pin, .spot-main').first().click()
  await page.locator('.story').waitFor() // 第一次先播初識劇情
  await page.keyboard.press('Escape') // 跳過劇情，開始讀書
  const src = (await page.locator('.stage .portrait img').getAttribute('src')) ?? ''
  const id = /characters\/([a-z]+)\//.exec(src)?.[1]
  const { characters } = JSON.parse(readFileSync(new URL('../../data/characters.json', import.meta.url), 'utf-8')) as {
    characters: { id: string; expressions: string[] }[]
  }
  const want = characters.find((c) => c.id === id)?.expressions.map((e) => `/characters/${id}/${e}.webp`) ?? []
  assert.ok(want.length >= 5, `找不到 ${src} 的表情清單`)
  await page.waitForFunction(
    (paths) => {
      const got = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname)
      return paths.every((p) => got.some((g) => g.endsWith(p)))
    },
    want,
    { timeout: 10_000 },
  )
  await ctx.close()
})

test('確認對話框：模擬考的開始與交卷；Esc、返回鍵等於取消，對話框開著時數字鍵不會作答', async () => {
  const ctx = await newContext({ mobile: true })
  const page = await open(ctx)
  await page.locator('button.option').first().waitFor()
  await page.getByRole('button', { name: '模擬考', exact: true }).click()
  const startButton = page.getByRole('row').getByRole('button', { name: '開始' }).first()
  const dialog = page.getByRole('alertdialog')

  await startButton.click()
  await dialog.waitFor()
  assert.match((await dialog.textContent()) ?? '', /限時/)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.mock-bar').count(), 0, '取消後不會開始')

  await startButton.click()
  await dialog.getByRole('button', { name: '開始' }).click()
  const bar = page.locator('.mock-bar')
  await bar.waitFor()

  await bar.getByRole('button', { name: '交卷' }).click()
  await dialog.waitFor()
  await page.keyboard.press('1')
  assert.match((await page.locator('.mock-count').textContent()) ?? '', /已答 0/, '對話框開著時按 1 不能選到底下題目的答案')
  await page.goBack() // 手機返回鍵：只關掉對話框，模擬考還在
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await bar.count(), 1)

  await bar.getByRole('button', { name: '交卷' }).click()
  await dialog.getByRole('button', { name: '交卷' }).click()
  await bar.waitFor({ state: 'detached' })
  await ctx.close()
})

test('所有頁面沒有 CSP 違規、沒有未處理的例外、沒有原生對話框', () => {
  assert.deepEqual(problems, [])
})
