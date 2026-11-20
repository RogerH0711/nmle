// 收藏、不確定、筆記的合併規則（marks.ts）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listOf, markOf, mergeMarks, NOTE_MAX, setMark, type Marks } from './marks.ts'

const T1 = new Date('2026-11-20T01:00:00.000Z')
const T2 = new Date('2026-11-20T02:00:00.000Z')

test('改標記：記下改的時間、標成還沒同步；沒有變就回傳同一個物件', () => {
  const a = setMark({}, 'q1', { favorite: true }, T1)
  assert.deepEqual(a.q1, { favorite: true, unsure: false, note: null, updated_at: T1.toISOString(), synced: false })
  assert.equal(setMark(a, 'q1', { favorite: true }, T2), a)
  const b = setMark({ ...a, q1: { ...a.q1, synced: true } }, 'q1', { unsure: true }, T2)
  assert.deepEqual(b.q1, { favorite: true, unsure: true, note: null, updated_at: T2.toISOString(), synced: false })
})

test('筆記：去掉頭尾空白，空的當成沒有筆記，太長截斷', () => {
  assert.equal(setMark({}, 'q1', { note: '  看圖  ' }, T1).q1.note, '看圖')
  assert.equal(setMark({}, 'q1', { note: '   ' }, T1).q1, undefined) // 本來就沒有筆記：沒有變
  assert.equal(setMark({}, 'q1', { note: 'x'.repeat(NOTE_MAX + 5) }, T1).q1.note?.length, NOTE_MAX)
  const a = setMark({}, 'q1', { note: '看圖' }, T1)
  assert.equal(setMark(a, 'q1', { note: '' }, T2).q1.note, null)
})

test('合併：每題取改的時間比較新的，舊的修改晚到也不會蓋掉', () => {
  const mine: Marks = { q1: { favorite: true, unsure: false, note: null, updated_at: T2.toISOString(), synced: false } }
  const old: Marks = { q1: { favorite: false, unsure: false, note: '舊', updated_at: T1.toISOString(), synced: true } }
  assert.equal(mergeMarks(mine, old), null)
  const merged = mergeMarks(old, mine)
  assert.deepEqual(merged?.q1, mine.q1)
})

test('合併：同一筆只要一邊已同步就算已同步；新的題目直接加進來', () => {
  const m = { favorite: true, unsure: false, note: null, updated_at: T1.toISOString() }
  const merged = mergeMarks({ q1: { ...m, synced: false } }, { q1: { ...m, synced: true }, q2: { ...m, synced: true } })
  assert.deepEqual(Object.keys(merged ?? {}).sort(), ['q1', 'q2'])
  assert.equal(merged?.q1.synced, true)
})

test('清單：收藏、不確定各自列出，依題號排序；取消的不列', () => {
  let marks: Marks = {}
  marks = setMark(marks, '115090_1_010', { favorite: true, unsure: true }, T1)
  marks = setMark(marks, '105020_2_003', { favorite: true }, T1)
  marks = setMark(marks, '110020_1_001', { unsure: true }, T1)
  marks = setMark(marks, '110020_1_001', { unsure: false }, T2)
  assert.deepEqual(listOf(marks, 'favorite'), ['105020_2_003', '115090_1_010'])
  assert.deepEqual(listOf(marks, 'unsure'), ['115090_1_010'])
  assert.deepEqual(markOf(marks, 'nope'), { favorite: false, unsure: false, note: null })
})
