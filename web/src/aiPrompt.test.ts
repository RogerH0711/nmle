// 「問 AI」提問的內容。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_SITES, askPrompt, MAX_URL_PROMPT, siteUrl } from './aiPrompt.ts'
import type { PaperInfo, Question } from './types.ts'

const paper: PaperInfo = { id: '115090_1', year: 115, session: 2, paper: '醫學(一)', file: '', count: 100 }
const base: Question = {
  id: '115090_1_005',
  number: 5,
  subject: 'anatomy',
  subject_status: 'range',
  stem: '下列何者支配三角肌？',
  options: ['腋神經', '橈神經', '正中神經', '尺神經'],
  answers: ['A'],
  free_point: false,
  answer_note: null,
  override_reason: null,
  images: [],
  explanation: null,
  explanation_status: 'none',
  valid: true,
  issues: [],
}

test('提問包含出處、題目、選項、正解和選的答案', () => {
  const p = askPrompt(base, paper, '解剖學', 'B')
  assert.match(p, /115 年第 2 次醫師第一階段考試 醫學\(一\) 第 5 題（解剖學）/)
  assert.match(p, /下列何者支配三角肌？/)
  assert.match(p, /\(A\) 腋神經\n\(B\) 橈神經\n\(C\) 正中神經\n\(D\) 尺神經/)
  assert.match(p, /官方正解：A\n我選的是：B/)
  assert.match(p, /為什麼正解是 A/)
  assert.doesNotMatch(p, /附圖/)
})

test('送分題、一題多解、附圖', () => {
  assert.match(askPrompt({ ...base, free_point: true }, paper, null, 'C'), /一律給分（送分題）[\s\S]*可能被送分/)
  assert.match(askPrompt({ ...base, answers: ['A', 'C'], answer_note: '更正答案' }, paper, null, 'A'), /官方正解：A、C（更正答案）/)
  assert.match(askPrompt({ ...base, images: ['x.png'] }, paper, null, 'A'), /附圖/)
})

test('網址帶入：太長或不支援的網站只開首頁', () => {
  const chatgpt = AI_SITES.find((s) => s.id === 'chatgpt')!
  const gemini = AI_SITES.find((s) => s.id === 'gemini')!
  const short = siteUrl(chatgpt, askPrompt(base, paper, null, 'A'))
  assert.equal(short.prefilled, true)
  assert.ok(short.href.startsWith('https://chatgpt.com/?q='))
  assert.deepEqual(siteUrl(chatgpt, '長'.repeat(MAX_URL_PROMPT)), { href: chatgpt.home, prefilled: false })
  assert.equal(siteUrl(gemini, '短').prefilled, false)
})
