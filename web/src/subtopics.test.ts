// 次主題（subtopics.ts）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { questionIdsOf, subtopicAbilities, subtopicName, subtopicOf, type SubtopicData } from './subtopics.ts'
import type { AnswerRecord } from './answers'

const data: SubtopicData = {
  model: 'test',
  subjects: {
    anatomy: [{ id: 'neuro', name: '神經解剖' }, { id: 'thorax', name: '胸部' }],
    physiology: [{ id: 'neuro', name: '神經生理' }],
  },
  papers: { '115090_1': ['neuro', 'thorax', '', 'neuro', 'neuro'] },
}
// 第 1–3 題解剖、第 4–5 題生理（同樣叫 neuro）
const subjectOf = (id: string) => (Number(id.slice(-3)) <= 3 ? 'anatomy' : 'physiology')
const answer = (q: number, correct: boolean, day: number): AnswerRecord => ({
  id: `${q}-${day}-${correct}`, question_id: `115090_1_${String(q).padStart(3, '0')}`, picked: 'A', correct,
  answered_at: new Date(2026, 10, day, 12).toISOString(), synced: false,
})

test('題目的次主題：還沒分類、不在資料裡的是 null', () => {
  assert.equal(subtopicOf(data, '115090_1_002'), 'thorax')
  assert.equal(subtopicOf(data, '115090_1_003'), null)
  assert.equal(subtopicOf(data, '110020_1_001'), null)
  assert.equal(subtopicName(data, 'physiology', 'neuro'), '神經生理')
  assert.equal(subtopicName(data, 'anatomy', null), null)
})

test('次主題的題目：不同學科同名的 id 不會混在一起', () => {
  assert.deepEqual(questionIdsOf(data, 'neuro', subjectOf, 'anatomy'), ['115090_1_001'])
  assert.deepEqual(questionIdsOf(data, 'neuro', subjectOf, 'physiology'), ['115090_1_004', '115090_1_005'])
})

test('次主題能力值：同一題同一天只算第一次，寫滿 5 題才有正確率', () => {
  const records = [
    answer(1, false, 1), answer(1, true, 1), // 同一天重做：只算第一次（錯）
    answer(1, true, 2), answer(1, true, 3), answer(1, true, 4), answer(1, true, 5),
    answer(2, true, 1),
  ]
  const [neuro, thorax] = subtopicAbilities(data, 'anatomy', records, subjectOf)
  assert.deepEqual(neuro, { id: 'neuro', name: '神經解剖', answered: 5, covered: 1, total: 1, rate: 80 })
  assert.deepEqual(thorax, { id: 'thorax', name: '胸部', answered: 1, covered: 1, total: 1, rate: null })
})
