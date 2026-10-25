// 作答紀錄的 localStorage 格式。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeAnswers, decodeLegacyAnswers, encodeAnswers, type StoredAnswer } from './answerStorage.ts'

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
