// 好感度與吃醋的推算規則。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { affection, GOALS, rival, subjectMap } from './affection.ts'
import type { AnswerRecord } from './answers.ts'

const map = subjectMap([
  { id: 'p_1', subject_runs: [[1, 50, 'pathology'], [51, 100, 'pharmacology']] },
  { id: 'p_2', subject_runs: [[1, 100, 'anatomy']] },
])
const FEI = ['pathology']

let seq = 0
const at = (day: string, minute = 0) => new Date(`${day}T10:${String(minute).padStart(2, '0')}:00`).toISOString()
const rec = (question_id: string, correct: boolean, answered_at = at('2026-10-14')): AnswerRecord => ({
  id: String(seq++),
  question_id,
  picked: 'A',
  correct,
  answered_at,
  synced: false,
})
const q = (paper: string, n: number) => `${paper}_${String(n).padStart(3, '0')}`

test('查學科：依題號區段', () => {
  assert.equal(map.of('p_1_050'), 'pathology')
  assert.equal(map.of('p_1_051'), 'pharmacology')
  assert.equal(map.of('x_1_001'), null)
  assert.equal(map.count('p_1', FEI), 50)
})

test('沒作答：初識，下一階要答對 30 題', () => {
  const a = affection(FEI, [], [], map)
  assert.equal(a.stage, 0)
  assert.deepEqual(a.next && [a.next.current, a.next.target], [0, GOALS.correct])
})

test('熟識：答對過的不同題目才算，同一題答對很多次只算一題、別的學科不算', () => {
  const records = [
    ...Array.from({ length: 10 }, () => rec(q('p_1', 1), true)),
    ...Array.from({ length: 40 }, (_, i) => rec(q('p_1', 51 + i % 50), true)),
  ]
  assert.equal(affection(FEI, records, [], map).next?.current, 1)
  const enough = Array.from({ length: 30 }, (_, i) => rec(q('p_1', i + 1), true))
  assert.equal(affection(FEI, enough, [], map).stage, 1)
})

test('在意：錯題複習到期後答對 10 次', () => {
  const base = Array.from({ length: 30 }, (_, i) => rec(q('p_1', i + 1), true))
  const reviews = Array.from({ length: 10 }, (_, i) => [
    rec(q('p_1', 31 + i), false, at('2026-10-14')),
    rec(q('p_1', 31 + i), true, at('2026-10-15')), // 隔天到期，按時答對
  ]).flat()
  assert.equal(affection(FEI, [...base, ...reviews.slice(0, -1)], [], map).next?.current, 9)
  assert.equal(affection(FEI, [...base, ...reviews], [], map).stage, 2)
})

// 30 題答對、10 次複習，達到「在意」
function caring() {
  return [
    ...Array.from({ length: 30 }, (_, i) => rec(q('p_1', i + 1), true, at('2026-10-01'))),
    ...Array.from({ length: 10 }, (_, i) => [
      rec(q('p_1', 31 + i), false, at('2026-10-01')),
      rec(q('p_1', 31 + i), true, at('2026-10-02')),
    ]).flat(),
  ]
}

test('心動：同一題同一天重做不算，連續 100 題正確率 65% 以上', () => {
  // caring() 有 50 次有效作答（40 對 10 錯），再補 50 題（15 對 35 錯）：最近 100 題 55%
  const more = Array.from({ length: 50 }, (_, i) => rec(q('p_1', i + 1), i < 15, at('2026-10-03', i)))
  const a = affection(FEI, [...caring(), ...more], [], map)
  assert.equal(a.stage, 2)
  assert.deepEqual(a.next && [a.next.current, a.next.target], [55, GOALS.rate])

  // 同一天重做同一題、全部答對：不算進正確率
  const redo = Array.from({ length: 50 }, (_, i) => rec(q('p_1', i + 1), true, at('2026-10-03', 59)))
  assert.equal(affection(FEI, [...caring(), ...more, ...redo], [], map).stage, 2)

  // 換一天全部答對：最近 100 題 = 15 對 35 錯 + 50 對 → 65%
  const later = Array.from({ length: 50 }, (_, i) => rec(q('p_1', i + 1), true, at('2026-10-04')))
  assert.equal(affection(FEI, [...caring(), ...more, ...later], [], map).stage, 3)
})

test('心動：達成過就不會降階', () => {
  const good = Array.from({ length: 50 }, (_, i) => rec(q('p_1', i + 1), true, at('2026-10-03')))
  const bad = Array.from({ length: 100 }, (_, i) => rec(q('p_1', (i % 50) + 1), false, at(i < 50 ? '2026-10-05' : '2026-10-06')))
  assert.equal(affection(FEI, [...caring(), ...good, ...bad], [], map).stage, 3)
})

test('告白前夕：模擬考裡她負責學科的得分率 60%，沒作答的算錯', () => {
  const good = Array.from({ length: 50 }, (_, i) => rec(q('p_1', i + 1), true, at('2026-10-03')))
  const submitted = at('2026-10-10')
  const mock = { paper_id: 'p_1', submitted_at: submitted }
  // 50 題病理只作答 30 題且全對：60%
  const exam = Array.from({ length: 30 }, (_, i) => rec(q('p_1', i + 1), true, submitted))
  const before = affection(FEI, [...caring(), ...good, ...exam.slice(1)], [mock], map)
  assert.equal(before.stage, 3)
  assert.equal(before.next?.current, 58)
  assert.equal(affection(FEI, [...caring(), ...good, ...exam], [mock], map).stage, 4)
  // 沒有她學科的考卷不算
  assert.equal(affection(FEI, [...caring(), ...good], [{ paper_id: 'p_2', submitted_at: submitted }], map).next?.label.startsWith('考一次'), true)
})

test('階段要依序達成：只有正確率高、沒做過複習，停在熟識', () => {
  const records = Array.from({ length: 100 }, (_, i) => rec(q('p_1', (i % 50) + 1), true, at(i < 50 ? '2026-10-01' : '2026-10-02')))
  assert.equal(affection(FEI, records, [], map).stage, 1)
})

const chars = [
  { id: 'fei', subjects: ['pathology'] },
  { id: 'zhixun', subjects: ['pharmacology'] },
  { id: 'jingcheng', subjects: ['anatomy'] },
]

test('吃醋：上次寫她的學科之後，在別人的學科寫了 20 題以上', () => {
  const [fei, zhixun, jingcheng] = chars
  const records = [
    rec(q('p_1', 1), true, at('2026-10-01')),
    ...Array.from({ length: 12 }, (_, i) => rec(q('p_1', 51 + i), true, at('2026-10-02', i))),
    ...Array.from({ length: 8 }, (_, i) => rec(q('p_2', 1 + i), true, at('2026-10-02', 30 + i))),
  ]
  assert.equal(rival(fei, chars, records, map), zhixun)
  assert.equal(rival(fei, chars, records.slice(0, -1), map), undefined) // 只有 19 題
  // 之後又寫了她的學科：重新計算
  assert.equal(rival(fei, chars, [...records, rec(q('p_1', 2), true, at('2026-10-03'))], map), undefined)
  assert.equal(rival(zhixun, chars, records, map), undefined) // 藥理剛寫過
  void jingcheng
})
