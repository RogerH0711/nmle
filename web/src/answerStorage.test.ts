// 作答紀錄的 localStorage 格式。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeAnswers, decodeLegacyAnswers, encodeAnswers, FULL_SYNC_MS, nextCursor, SYNC_OVERLAP_MS, syncPlan, type StoredAnswer,
} from './answerStorage.ts'

const sample: StoredAnswer[] = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', question_id: '115090_1_062', picked: 'C', correct: true, answered_at: '2026-10-25T15:45:35.369Z', synced: true },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', question_id: '110020_2_001', picked: 'A', correct: false, answered_at: '2026-10-26T00:00:00.000Z', synced: false },
]

test('存進去再讀出來一模一樣', () => {
  assert.deepEqual(decodeAnswers(encodeAnswers(sample)), sample)
  assert.deepEqual(decodeAnswers(encodeAnswers([])), [])
})

test('比 JSON 省一半以上的空間', () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...sample[i % 2], id: crypto.randomUUID() }))
  assert.ok(encodeAnswers(many).length < JSON.stringify(many).length / 2)
})

test('壞掉的行略過，不會整份讀不出來', () => {
  const text = encodeAnswers(sample) + '\n\nbroken-line'
  assert.equal(decodeAnswers(text).length, 2)
})

test('舊版 JSON 讀得出來，資料庫的時間格式統一成 ISO', () => {
  const legacy = JSON.stringify([{ ...sample[0], answered_at: '2026-10-25T15:45:35.369+00:00' }])
  assert.deepEqual(decodeLegacyAnswers(legacy), [sample[0]])
})

test('同步：第一次和超過一天沒有完整同步時拉全部，其他時候只拉上次之後的（往前多拉 5 分鐘）', () => {
  const now = Date.parse('2026-10-26T12:00:00Z')
  assert.deepEqual(syncPlan(null, now), { since: null })
  const cursor = { syncedAt: '2026-10-26T11:00:00.000Z', fullAt: now - 60_000 }
  assert.deepEqual(syncPlan(cursor, now), { since: new Date(Date.parse(cursor.syncedAt) - SYNC_OVERLAP_MS).toISOString() })
  assert.deepEqual(syncPlan({ ...cursor, fullAt: now - FULL_SYNC_MS - 1 }, now), { since: null })
})

test('同步：游標取拉到的最新時間，資料庫的 +00:00 格式也比得對；完整同步才更新 fullAt', () => {
  const now = 1_000_000
  const prev = { syncedAt: '2026-10-26T11:00:00.000Z', fullAt: 5 }
  assert.deepEqual(nextCursor(prev, ['2026-10-26T10:00:00+00:00', '2026-10-26T11:30:00.123+00:00'], false, now), {
    syncedAt: '2026-10-26T11:30:00.123Z', fullAt: 5,
  })
  assert.deepEqual(nextCursor(prev, [], true, now), { syncedAt: prev.syncedAt, fullAt: now })
  assert.deepEqual(nextCursor(null, [], true, now), { syncedAt: '1970-01-01T00:00:00.000Z', fullAt: now })
})

