import type { AnswerRecord } from './answers'
import type { MockRecord } from './mock'
import type { PaperInfo } from './types'
import { localDate, reviewPasses } from './review.ts'

// 好感度：和錯題複習一樣，完全由作答紀錄與模擬考紀錄推算，不另外存。
// - 只看她負責學科的題目，不論是在「一起讀書」、依考卷刷題還是模擬考裡寫的。
// - 各階條件依序達成；達成過一次就算數，之後正確率掉下來也不會降階。
// - 主要看答對、複習和正確率，不看刷了幾題（docs/design.md「避免只追求量」）。

export const STAGE_NAMES = ['初識', '熟識', '在意', '心動', '告白前夕', '結局']
export const MAX_STAGE = 4 // 5 結局在玩家考完一階後才解鎖，還沒做

export const GOALS = {
  correct: 30, // 1 熟識：她的學科答對過的不同題目數
  passes: 10, // 2 在意：她的學科錯題複習「到期後按時答對」的次數
  window: 100, // 3 心動：她的學科連續 WINDOW 次作答（同一題同一天只算第一次）
  rate: 65, //    正確率達 RATE%
  mockRate: 60, // 4 告白前夕：一次模擬考裡，她負責學科的得分率達 MOCK_RATE%
}

export interface SubjectMap {
  of: (questionId: string) => string | null
  /** 這份考卷裡屬於這些學科的題數 */
  count: (paperId: string, subjects: string[]) => number
  /** 整個題庫裡這個學科的題數 */
  total: (subject: string) => number
}

/** 用 index.json 的 subject_runs 查題目的學科，不用載入整份考卷 */
export function subjectMap(papers: Pick<PaperInfo, 'id' | 'subject_runs'>[]): SubjectMap {
  const runs = new Map(papers.map((p) => [p.id, p.subject_runs ?? []]))
  const count = (paperId: string, subjects: string[]) =>
    (runs.get(paperId) ?? []).reduce((sum, [lo, hi, s]) => sum + (subjects.includes(s) ? hi - lo + 1 : 0), 0)
  return {
    of(questionId) {
      const cut = questionId.lastIndexOf('_')
      const n = Number(questionId.slice(cut + 1))
      const run = runs.get(questionId.slice(0, cut))?.find(([lo, hi]) => lo <= n && n <= hi)
      return run ? run[2] : null
    },
    count,
    total: (subject) => [...runs.keys()].reduce((sum, id) => sum + count(id, [subject]), 0),
  }
}

export interface Goal {
  label: string
  current: number
  target: number
  unit: string
}

export interface Affection {
  stage: number
  next: Goal | null // 下一階的條件與目前進度；null 表示已到目前能達到的最高階
}

const time = (iso: string) => new Date(iso).getTime()

/** 同一題同一天只算第一次，避免重做錯題刷正確率（同週榜）。records 要先依時間排好 */
export function dailyFirsts(records: AnswerRecord[]): AnswerRecord[] {
  const seen = new Set<string>()
  return records.filter((r) => {
    const key = `${r.question_id}|${localDate(new Date(r.answered_at))}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function affection(
  subjects: string[],
  records: AnswerRecord[],
  mocks: Pick<MockRecord, 'paper_id' | 'submitted_at'>[],
  map: SubjectMap,
): Affection {
  const mine = records
    .filter((r) => subjects.includes(map.of(r.question_id) ?? ''))
    .sort((a, b) => time(a.answered_at) - time(b.answered_at))

  // 1 熟識
  const correct = new Set(mine.filter((r) => r.correct).map((r) => r.question_id)).size

  // 2 在意
  const passes = reviewPasses(mine).length

  // 3 心動：同一題同一天只算第一次
  const firsts = dailyFirsts(mine)
  let hits = 0
  let bestRate = 0
  let lastRate = 0
  for (let i = 0; i < firsts.length; i++) {
    if (firsts[i].correct) hits++
    if (i >= GOALS.window && firsts[i - GOALS.window].correct) hits--
    if (i >= GOALS.window - 1) {
      lastRate = (hits / GOALS.window) * 100
      bestRate = Math.max(bestRate, lastRate)
    }
  }

  // 4 告白前夕：模擬考交卷時每題都寫進作答紀錄，時間就是交卷時間；沒作答的題目算錯
  let mockRate = 0
  let tookMock = false
  for (const m of mocks) {
    const total = map.count(m.paper_id, subjects)
    if (!total) continue
    tookMock = true
    const at = time(m.submitted_at)
    const right = mine.filter((r) => r.correct && time(r.answered_at) === at && r.question_id.startsWith(m.paper_id + '_')).length
    mockRate = Math.max(mockRate, (right / total) * 100)
  }

  const reached = [
    correct >= GOALS.correct,
    passes >= GOALS.passes,
    bestRate >= GOALS.rate,
    mockRate >= GOALS.mockRate,
  ]
  const firstMissing = reached.indexOf(false)
  const stage = firstMissing === -1 ? MAX_STAGE : firstMissing

  const goals: (Goal | null)[] = [
    { label: '答對她負責學科的題目', current: correct, target: GOALS.correct, unit: '題' },
    { label: '錯題複習到期後答對', current: passes, target: GOALS.passes, unit: '次' },
    firsts.length < GOALS.window
      ? { label: '她的學科累積作答', current: firsts.length, target: GOALS.window, unit: '題' }
      : { label: `她的學科最近 ${GOALS.window} 題正確率`, current: Math.round(lastRate), target: GOALS.rate, unit: '%' },
    {
      label: tookMock ? '模擬考中她的學科得分率（最好的一次）' : '考一次模擬考，她的學科得分率',
      current: Math.round(mockRate),
      target: GOALS.mockRate,
      unit: '%',
    },
    null,
  ]
  return { stage, next: goals[stage] }
}

/**
 * 吃醋：上次寫她的學科之後，在別人負責的學科寫了至少 min 題，就回傳寫最多的那位。
 * 由作答紀錄推算，換裝置也一樣。
 */
export function rival<C extends { id: string; subjects: string[] }>(
  me: C,
  characters: C[],
  records: AnswerRecord[],
  map: SubjectMap,
  min = 20,
): C | undefined {
  const counts = new Map<C, number>()
  const sorted = [...records].sort((a, b) => time(b.answered_at) - time(a.answered_at))
  for (const r of sorted) {
    const s = map.of(r.question_id)
    if (!s) continue
    if (me.subjects.includes(s)) break
    const owner = characters.find((c) => c !== me && c.subjects.includes(s))
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  let best: C | undefined
  let total = 0
  for (const [c, n] of counts) {
    total += n
    if (!best || n > counts.get(best)!) best = c
  }
  return total >= min ? best : undefined
}
