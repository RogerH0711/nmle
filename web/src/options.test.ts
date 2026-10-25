// 選項打亂。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { canShuffle, makeOrder, relabelExplanation, shownQuestion, toOriginal, toShown } from './options.ts'
import type { ExamFile, Question } from './types.ts'

const q = (extra: Partial<Question> = {}): Question => ({
  id: '113020_1_001', number: 1, subject: 'pharmacology', subject_status: 'range', stem: '題幹',
  options: ['甲', '乙', '丙', '丁'], answers: ['B'], free_point: false, answer_note: null, override_reason: null,
  images: [], explanation: null, explanation_status: 'none', valid: true, issues: [], ...extra,
})

test('畫面上的字母和原本的字母互換', () => {
  const order = [2, 0, 3, 1] // 畫面 A 放原本的 C、B 放 A、C 放 D、D 放 B
  assert.equal(toOriginal(order, 'A'), 'C')
  assert.equal(toOriginal(order, 'D'), 'B')
  assert.equal(toShown(order, 'C'), 'A')
  assert.equal(toShown(order, 'B'), 'D')
  const s = shownQuestion(q(), order)
  assert.deepEqual(s.options, ['丙', '甲', '丁', '乙'])
  assert.deepEqual(s.answers, ['D']) // 原本的 B（乙）在畫面第四個
})

test('打亂的結果是 0–3 的排列；不能打亂的題目維持原順序', () => {
  let seed = 1
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 50; i++) assert.deepEqual([...makeOrder(q(), random)].sort(), [0, 1, 2, 3])
  assert.deepEqual(makeOrder(q({ answers: ['A', 'B'] })), [0, 1, 2, 3])
  assert.deepEqual(makeOrder(q({ answer_note: '第1題答Ａ、Ｂ給分' })), [0, 1, 2, 3])
  assert.deepEqual(makeOrder(q({ free_point: true })), [0, 1, 2, 3])
  assert.deepEqual(makeOrder(q({ options: ['甲', '乙', '丙', '以上皆是'] })), [0, 1, 2, 3])
  assert.deepEqual(makeOrder(q({ options: ['甲', '乙', 'A與B皆正確', '丁'] })), [0, 1, 2, 3])
  assert.ok(canShuffle(q({ options: ['A 校與 B 校', 'A 型肝炎', '維生素 A', '60 歲以上'] }))) // 題幹的標籤、名詞不算
})

test('詳解：字母換成畫面上的，選項解析照畫面順序排；V(D)J 不換', () => {
  const text = [
    '**關鍵觀念**',
    'V(D)J 重組。選項C錯在（C）的敘述。',
    '',
    '**選項解析**',
    '- (A) 錯誤。甲。',
    '- (B) 正確。乙。',
    '- (C) 錯誤。理由同(A)。',
    '- (D) 錯誤。丁。',
  ].join('\n')
  const out = relabelExplanation(text, [2, 0, 3, 1]).split('\n')
  assert.equal(out[1], 'V(D)J 重組。選項A錯在（A）的敘述。')
  assert.deepEqual(out.slice(4), ['- (A) 錯誤。理由同(B)。', '- (B) 錯誤。甲。', '- (C) 錯誤。丁。', '- (D) 正確。乙。'])
  assert.equal(relabelExplanation(text, [0, 1, 2, 3]), text)
})

// ---------- 實際資料 ----------
const data = new URL('../../data/', import.meta.url)
const questions = readdirSync(new URL('questions/', data))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(new URL(`questions/${f}`, data), 'utf-8')) as ExamFile).questions)

test('題庫：只有一題多解、有官方註記或一律給分的題目不打亂（選項參照規則沒有誤判）', () => {
  const fixed = questions.filter((x) => !canShuffle(x))
  assert.ok(questions.length > 2000)
  for (const x of fixed) assert.ok(x.answers.length !== 1 || x.answer_note || x.free_point, `${x.id} 被當成選項參照`)
})

test('詳解：每份詳解換字母後，選項解析還是 A–D 各一項', () => {
  const dir = new URL('explanations/', data)
  let checked = 0
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const file = JSON.parse(readFileSync(new URL(f, dir), 'utf-8')) as { questions: Record<string, { text: string }> }
    for (const e of Object.values(file.questions)) {
      const heads = (t: string) => t.split('\n').map((l) => /^\s*[-*]\s+[（(]([A-D])[)）]/.exec(l)?.[1]).filter(Boolean)
      const before = heads(e.text)
      if (before.join('') !== 'ABCD') continue // 少數詳解的選項解析不是標準格式，照原樣顯示
      assert.deepEqual(heads(relabelExplanation(e.text, [3, 1, 0, 2])), ['A', 'B', 'C', 'D'])
      checked++
    }
  }
  assert.ok(checked > 2000, `只檢查到 ${checked} 篇`)
})
