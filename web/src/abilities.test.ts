// 狀態面板能力值的推算規則。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abilities, grade, MIN_ANSWERS, RECENT, weakest } from './abilities.ts'
import { subjectMap } from './affection.ts'
import type { AnswerRecord } from './answers.ts'

const map = subjectMap([
  { id: 'p_1', subject_runs: [[1, 50, 'pathology'], [51, 100, 'pharmacology']] },
  { id: 'p_2', subject_runs: [[1, 100, 'anatomy']] },
  { id: 'p_3', subject_runs: [[1, 200, 'pathology']] },
])
const SUBJECTS = ['pathology', 'pharmacology', 'anatomy']

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
const of = (list: ReturnType<typeof abilities>, s: string) => list.find((a) => a.subject === s)!

// 第 i 筆紀錄放在 1/1 起的第 i 天，時間順序明確
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i, 2)).toISOString()

test('題庫題數：跨考卷加總', () => {
  assert.equal(of(abilities(SUBJECTS, [], map), 'pathology').total, 250)
  assert.equal(of(abilities(SUBJECTS, [], map), 'anatomy').total, 100)
})

test('題數不夠時沒有能力值', () => {
  const records = Array.from({ length: MIN_ANSWERS - 1 }, (_, i) => rec(q('p_2', i + 1), true))
  const a = of(abilities(SUBJECTS, records, map), 'anatomy')
  assert.equal(a.answered, MIN_ANSWERS - 1)
  assert.equal(a.rate, null)
})

test('同一題同一天只算第一次；別的學科不算', () => {
  const records = [
    rec(q('p_2', 1), false, at('2026-10-14', 0)),
    ...Array.from({ length: 5 }, (_, i) => rec(q('p_2', 1), true, at('2026-10-14', i + 1))),
    ...Array.from({ length: 9 }, (_, i) => rec(q('p_2', i + 2), true)),
    rec(q('p_1', 1), true),
  ]
  const a = of(abilities(SUBJECTS, records, map), 'anatomy')
  assert.equal(a.answered, 10)
  assert.equal(a.covered, 10)
  assert.equal(a.rate, 90)
  assert.equal(of(abilities(SUBJECTS, records, map), 'pathology').answered, 1)
})

test('能力值只看最近 RECENT 題，並和再之前比', () => {
  const old = Array.from({ length: RECENT }, (_, i) => rec(q('p_3', i + 1), i % 2 === 0, day(i))) // 50%
  const recent = Array.from({ length: RECENT }, (_, i) => rec(q('p_3', RECENT + i + 1), i % 5 !== 0, day(RECENT + i))) // 80%
  const a = of(abilities(SUBJECTS, [...recent, ...old], map), 'pathology')
  assert.equal(a.answered, 2 * RECENT)
  assert.equal(a.rate, 80)
  assert.equal(a.change, 30)
})

test('等級與及格線', () => {
  assert.equal(grade(90), 'S')
  assert.equal(grade(60), 'C')
  assert.equal(grade(59), 'D')
  assert.equal(grade(10), 'E')
})

test('最需要加強：有能力值的取最低，都沒有時取寫最少的', () => {
  const ten = (paper: string, from: number, correct: number) =>
    Array.from({ length: 10 }, (_, i) => rec(q(paper, from + i), i < correct))
  const list = abilities(SUBJECTS, [...ten('p_1', 1, 8), ...ten('p_2', 1, 4)], map)
  assert.equal(weakest(list)?.subject, 'anatomy')
  const none = abilities(SUBJECTS, [rec(q('p_1', 1), true), rec(q('p_2', 1), true)], map)
  assert.equal(weakest(none)?.subject, 'pharmacology')
})
