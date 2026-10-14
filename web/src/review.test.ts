// 錯題複習（Leitner box）的推算規則。執行：npm test（Node 24 可以直接跑 TypeScript）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewStates, reviewSummary } from './review.ts'

let seq = 0
const at = (day: string) => new Date(`${day}T10:00:00`).toISOString() // 本地時間上午 10 點
const rec = (question_id: string, day: string, correct: boolean) => ({
  id: String(seq++),
  question_id,
  picked: 'A' as const,
  correct,
  answered_at: at(day),
  synced: false,
})

test('答錯：放回第 1 格，隔天到期', () => {
  const s = reviewStates([rec('q1', '2026-10-14', false)])
  assert.deepEqual(s.get('q1'), { box: 0, due: '2026-10-15', done: false })
})

test('還沒到期就答對不算數', () => {
  const s = reviewStates([rec('q1', '2026-10-14', false), rec('q1', '2026-10-14', true)])
  assert.deepEqual(s.get('q1'), { box: 0, due: '2026-10-15', done: false })
})

test('依 1、3、7、14 天間隔答對會一格一格往後移', () => {
  const s = reviewStates([
    rec('q1', '2026-10-14', false),
    rec('q1', '2026-10-15', true),
    rec('q1', '2026-10-18', true),
    rec('q1', '2026-10-25', true),
  ])
  assert.deepEqual(s.get('q1'), { box: 3, due: '2026-11-08', done: false })
})

test('最後一格到期後答對：攻略完成', () => {
  const s = reviewStates([
    rec('q1', '2026-10-14', false),
    rec('q1', '2026-10-15', true),
    rec('q1', '2026-10-18', true),
    rec('q1', '2026-10-25', true),
    rec('q1', '2026-11-10', true),
  ])
  assert.equal(s.get('q1')?.done, true)
})

test('攻略完成後又答錯：回到第 1 格', () => {
  const s = reviewStates([
    rec('q1', '2026-10-14', false),
    rec('q1', '2026-10-15', true),
    rec('q1', '2026-10-18', true),
    rec('q1', '2026-10-25', true),
    rec('q1', '2026-11-10', true),
    rec('q1', '2026-12-01', false),
  ])
  assert.deepEqual(s.get('q1'), { box: 0, due: '2026-12-02', done: false })
})

test('從沒答錯的題目不進複習佇列', () => {
  assert.equal(reviewStates([rec('q2', '2026-10-14', true)]).has('q2'), false)
})

test('跨月份計算到期日', () => {
  assert.equal(reviewStates([rec('q3', '2026-10-31', false)]).get('q3')?.due, '2026-11-01')
})

test('紀錄順序不影響結果（離線作答晚同步）', () => {
  const records = [rec('q4', '2026-10-15', true), rec('q4', '2026-10-14', false)]
  assert.deepEqual(reviewStates(records).get('q4'), { box: 1, due: '2026-10-18', done: false })
})

test('統計：今天到期的排前面，拖最久的最先複習', () => {
  const sum = reviewSummary(
    reviewStates([rec('a', '2026-10-13', false), rec('b', '2026-10-10', false), rec('c', '2026-10-14', false)]),
    '2026-10-14',
  )
  assert.deepEqual(sum.due, ['b', 'a'])
  assert.equal(sum.waiting, 1)
  assert.equal(sum.done, 0)
})
