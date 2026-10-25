// 題庫搜尋的比對與網址。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bankHash, highlight, parseBankHash, parseQuery, searchBank } from './search.ts'
import type { Question } from './types.ts'

const q = (id: string, stem: string, options: string[], extra: Partial<Question> = {}): Question => ({
  id, number: Number(id.slice(-3)), subject: 'pharmacology', subject_status: 'range', stem,
  options: options as Question['options'], answers: ['A'], free_point: false, answer_note: null, override_reason: null,
  images: [], explanation: null, explanation_status: 'none', valid: true, issues: [], ...extra,
})

const bank = [
  q('113020_1_001', '下列何者屬於 aminoglycoside？', ['Gentamicin', 'Vancomycin', 'Penicillin', 'Aspirin']),
  q('113020_2_005', '第2天出現發燒', ['甲', '乙', '丙', '丁'], { subject: 'microbiology' }),
  q('112020_1_010', 'ＶＡＮＣＯＭＹＣＩＮ 的作用機轉', ['a', 'b', 'c', 'd']),
  q('112020_1_011', '沒出題', ['a', 'b', 'c', 'd'], { valid: false }),
]
const ids = (hits: { q: Question }[]) => hits.map((h) => h.q.id)

test('關鍵字不分大小寫、全半形，選項也搜', () => {
  const hits = searchBank(bank, { scope: 'all', subject: 'all', terms: parseQuery('vancomycin') })
  assert.deepEqual(ids(hits), ['113020_1_001', '112020_1_010'])
})

test('略過空白：「第 2 天」找得到「第2天」；多個關鍵字要同時出現', () => {
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', terms: parseQuery('第 2 天') })), ['113020_2_005'])
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', terms: parseQuery('gentamicin aspirin') })), ['113020_1_001'])
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', terms: parseQuery('gentamicin 發燒') })), [])
})

test('範圍：某年全部、單份考卷；學科；不列沒出題的題目', () => {
  assert.deepEqual(ids(searchBank(bank, { scope: 'y113', subject: 'all', terms: [] })), ['113020_1_001', '113020_2_005'])
  assert.deepEqual(ids(searchBank(bank, { scope: '112020_1', subject: 'all', terms: [] })), ['112020_1_010'])
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'microbiology', terms: [] })), ['113020_2_005'])
})

test('只有詳解提到的題目另外標示；關鍵字可以一半在題目、一半在詳解', () => {
  const exp = new Map([['112020_1_010', '抑制細胞壁合成'], ['113020_2_005', '病毒感染']])
  const hits = searchBank(bank, { scope: 'all', subject: 'all', terms: parseQuery('細胞壁 vancomycin') }, exp)
  assert.deepEqual(hits.map((h) => [h.q.id, h.inExplanation]), [['112020_1_010', true]])
})

test('標示符合的片段，對回原文（含中間的空白、全形字）', () => {
  assert.deepEqual(highlight('與 IL-5 有關', parseQuery('與il-5')), [
    { text: '與 IL-5', mark: true },
    { text: ' 有關', mark: false },
  ])
  assert.deepEqual(highlight('ＡＢ和AB', parseQuery('ab')), [
    { text: 'ＡＢ', mark: true },
    { text: '和', mark: false },
    { text: 'AB', mark: true },
  ])
  assert.deepEqual(highlight('沒有', []), [{ text: '沒有', mark: false }])
})

test('網址來回轉換；亂打的範圍當成全部', () => {
  const r = { scope: '113020_1', number: 45, query: '抗生素', subject: 'pharmacology' }
  assert.deepEqual(parseBankHash(bankHash(r)), r)
  assert.deepEqual(parseBankHash('#/bank'), { scope: 'all', number: null, query: '', subject: 'all' })
  assert.deepEqual(parseBankHash('#/bank/y113'), { scope: 'y113', number: null, query: '', subject: 'all' })
  assert.equal(parseBankHash('#/bank/<script>')?.scope, 'all')
  assert.equal(parseBankHash('#/bank/y113/5')?.number, null) // 題號只對單份考卷有意義
  assert.equal(parseBankHash('#/other'), null)
  assert.equal(parseBankHash(''), null)
})
