// 多個分頁的紀錄合併（merge.ts）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeByKey, mergeRecords } from './merge.ts'

const at = (r: { at: string }) => r.at
const rec = (id: string, t: string, synced = false) => ({ id, at: t, synced })

test('別的分頁的新紀錄併進來，依時間排序', () => {
  const mine = [rec('a', '2026-11-16T01:00:00.000Z'), rec('c', '2026-11-16T03:00:00.000Z')]
  const theirs = [rec('a', '2026-11-16T01:00:00.000Z'), rec('b', '2026-11-16T02:00:00.000Z')]
  assert.deepEqual(mergeRecords(mine, theirs, at)?.map((r) => r.id), ['a', 'b', 'c'])
})

test('沒有新東西回傳 null（不用重新渲染）', () => {
  const mine = [rec('a', '2026-11-16T01:00:00.000Z', true)]
  assert.equal(mergeRecords(mine, [rec('a', '2026-11-16T01:00:00.000Z', false)], at), null)
  assert.equal(mergeRecords(mine, [], at), null)
})

test('同一筆只要一邊已同步就算已同步，不會重複上傳', () => {
  const merged = mergeRecords([rec('a', '2026-11-16T01:00:00.000Z')], [rec('a', '2026-11-16T01:00:00.000Z', true)], at)
  assert.deepEqual(merged, [rec('a', '2026-11-16T01:00:00.000Z', true)])
})

test('訊息依 key 合併：別的分頁收到的留著，讀過的標記不會被蓋回未讀', () => {
  const stored = [{ key: 'review:1', read: true }, { key: 'story:fei-1', read: false }]
  const mine = [{ key: 'review:1', read: false }, { key: 'streak:3', read: false }]
  assert.deepEqual(mergeByKey(stored, mine), [
    { key: 'review:1', read: true },
    { key: 'story:fei-1', read: false },
    { key: 'streak:3', read: false },
  ])
  assert.deepEqual(mergeByKey(stored, [{ key: 'story:fei-1', read: true }])[1], { key: 'story:fei-1', read: true })
})
