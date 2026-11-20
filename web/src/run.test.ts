// 一回合的純函式（run.ts）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCorrect, paperQueue, pickRound, runStats, subjectQuestionIds, withOrders, wrongIds, type Run } from './run.ts'
import type { Question } from './types'

const q = (n: number, patch: Partial<Question> = {}): Question => ({
  id: `115090_1_${String(n).padStart(3, '0')}`, number: n, subject: 'anatomy', subject_status: 'range',
  stem: `第 ${n} 題`, options: ['a', 'b', 'c', 'd'], answers: ['A'], free_point: false, answer_note: null,
  override_reason: null, images: [], explanation: null, explanation_status: 'none', valid: true, issues: [], ...patch,
})
const run = (patch: Partial<Run>): Run => ({ kind: 'paper', paperId: '115090_1', subject: 'all', order: 'seq', queue: [], pos: 0, picks: {}, ...patch })

test('對錯：正解之一、送分題任何答案都對', () => {
  assert.equal(isCorrect(q(1), 'A'), true)
  assert.equal(isCorrect(q(1), 'B'), false)
  assert.equal(isCorrect(q(1, { answers: ['A', 'C'] }), 'C'), true)
  assert.equal(isCorrect(q(1, { free_point: true }), 'D'), true)
})

test('依考卷出題：只出可作答的題目、可以篩學科、依題號或打亂', () => {
  const qs = [q(1), q(2, { valid: false }), q(3, { subject: 'pathology' }), q(4)]
  assert.deepEqual(paperQueue(qs, 'all', 'seq'), [qs[0].id, qs[2].id, qs[3].id])
  assert.deepEqual(paperQueue(qs, 'anatomy', 'seq'), [qs[0].id, qs[3].id])
  assert.deepEqual(paperQueue(qs, 'all', 'random').sort(), [qs[0].id, qs[2].id, qs[3].id].sort())
})

test('選項順序：補上沒有的、已經決定的不變，檢討模擬考不打亂', () => {
  const qs = new Map([q(1), q(2)].map((x) => [x.id, x]))
  const [a, b] = [...qs.keys()]
  const fixed = [3, 2, 1, 0] as const
  const r = withOrders(run({ queue: [a, b], orders: { [a]: [...fixed] } }), qs)
  assert.deepEqual(r.orders?.[a], fixed)
  assert.equal(r.orders?.[b]?.length, 4)
  assert.equal(withOrders(run({ kind: 'mock', queue: [a, b] }), qs).orders, undefined)
})

test('成績與錯題：只算作答過的，照回合裡的順序', () => {
  const qs = new Map([q(1), q(2), q(3)].map((x) => [x.id, x]))
  const [a, b, c] = [...qs.keys()]
  const r = run({ queue: [a, b, c], picks: { a: 'A', [a]: 'A', [c]: 'B' } })
  assert.deepEqual(runStats(r, qs), { answered: 2, correct: 1 })
  assert.deepEqual(wrongIds(r, qs), [c])
  assert.deepEqual(runStats(null, qs), { answered: 0, correct: 0 })
})

test('和學姊讀書：題號由學科區段算出來，沒寫過的排前面', () => {
  const papers = [
    { id: '115090_1', subject_runs: [[1, 2, 'anatomy'], [3, 4, 'physiology']] as [number, number, string][] },
    { id: '105020_2', subject_runs: [[1, 2, 'physiology'], [3, 4, 'pathology']] as [number, number, string][] },
  ]
  const ids = subjectQuestionIds(papers, ['physiology'])
  assert.deepEqual(ids, ['115090_1_003', '115090_1_004', '105020_2_001', '105020_2_002'])
  const round = pickRound(ids, new Set(['115090_1_003', '105020_2_001']), 3)
  assert.equal(round.length, 3)
  assert.deepEqual(round.slice(0, 2).sort(), ['105020_2_002', '115090_1_004'])
})
