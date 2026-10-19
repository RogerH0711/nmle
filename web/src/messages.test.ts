// 學姊傳訊息的觸發規則。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillVars, messageEvents, streakDays } from './messages.ts'
import type { SubjectMap } from './affection.ts'

// 測試用的學科對照：題號 1–50 是病理、51–100 是生理
const subjects: SubjectMap = {
  of: (id) => (Number(id.slice(-3)) <= 50 ? 'pathology' : 'physiology'),
  count: () => 0,
  total: () => 0,
}
const characters = [
  { id: 'yiqing', subjects: ['physiology', 'biochemistry'] },
  { id: 'fei', subjects: ['pathology', 'public_health'] },
]
let seq = 0
const rec = (day: string, n: number, time = '10:00') => ({
  id: String(seq++),
  question_id: `115090_2_${String(n).padStart(3, '0')}`,
  picked: 'A' as const,
  correct: true,
  answered_at: new Date(`${day}T${time}:00`).toISOString(),
  synced: true,
})
const base = { characters, subjects, newScenes: [], comebackDays: 3, dueIds: [] as string[] }
const kinds = (events: { kind: string }[]) => events.map((e) => e.kind)

test('錯題到期：由到期題數最多的學科的負責學姊傳，帶入總題數', () => {
  const events = messageEvents({ ...base, records: [rec('2026-10-19', 1)], dueIds: ['115090_2_001', '115090_2_002', '115090_2_080'], today: '2026-10-19' })
  assert.deepEqual(events, [{ key: 'review:2026-10-19', kind: 'review', character: 'fei', vars: { n: 3 } }])
})

test('久沒上線：超過 3 天才傳，由最後寫的那題的負責學姊傳', () => {
  const records = [rec('2026-10-10', 1), rec('2026-10-15', 70)]
  assert.deepEqual(kinds(messageEvents({ ...base, records, today: '2026-10-18' })), []) // 隔 3 天還不算
  const events = messageEvents({ ...base, records, today: '2026-10-19' })
  assert.deepEqual(events, [{ key: 'comeback:2026-10-15', kind: 'comeback', character: 'yiqing', vars: { days: 4 } }])
})

test('新劇情：初識不另外傳，熟識以後才傳', () => {
  const events = messageEvents({
    ...base,
    records: [rec('2026-10-19', 1)],
    newScenes: [{ character: 'yiqing', stage: 0 }, { character: 'fei', stage: 1 }],
    today: '2026-10-19',
  })
  assert.deepEqual(events, [{ key: 'story:fei-1', kind: 'story', character: 'fei', vars: {} }])
})

test('連續作答：一天至少 10 題才算一天，今天達到 3 天時傳', () => {
  const day = (d: string, n: number, q: number) => Array.from({ length: n }, () => rec(d, q))
  const records = [...day('2026-10-17', 10, 1), ...day('2026-10-18', 10, 1), ...day('2026-10-19', 9, 60)]
  assert.equal(streakDays(records, '2026-10-19'), 0) // 今天只有 9 題
  records.push(rec('2026-10-19', 60))
  assert.equal(streakDays(records, '2026-10-19'), 3)
  const events = messageEvents({ ...base, records, today: '2026-10-19' })
  // 今天寫的是生理，由夏以晴傳
  assert.deepEqual(events, [{ key: 'streak:3:2026-10-19', kind: 'streak', character: 'yiqing', vars: { days: 3 } }])
  assert.deepEqual(kinds(messageEvents({ ...base, records, today: '2026-10-20' })), []) // 隔天還沒寫，不是里程碑
})

test('連續天數跨月份也算對', () => {
  const day = (d: string) => Array.from({ length: 10 }, () => rec(d, 1))
  assert.equal(streakDays([...day('2026-09-30'), ...day('2026-10-01')], '2026-10-01'), 2)
})

test('沒有作答紀錄、也沒有角色時不傳任何訊息', () => {
  assert.deepEqual(messageEvents({ ...base, records: [], today: '2026-10-19' }), [])
  assert.deepEqual(messageEvents({ ...base, characters: [], records: [rec('2026-10-01', 1)], dueIds: ['115090_2_001'], today: '2026-10-19' }), [])
})

test('台詞裡的變數換成實際的值，不認得的保留', () => {
  assert.equal(fillVars('你有 {n} 題，{player}，連續 {days} 天', { n: 5, days: 3 }), '你有 5 題，{player}，連續 3 天')
})
