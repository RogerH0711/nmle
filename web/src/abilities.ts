import type { AnswerRecord } from './answers'
import { dailyFirsts, type SubjectMap } from './affection.ts'

// 狀態面板的「能力值」：各科最近的正確率。和好感度一樣，完全由作答紀錄推算，不另外存。
// 同一題同一天只算第一次，重做錯題不會把能力值刷高。

export const RECENT = 50 // 能力值看最近幾題
export const MIN_ANSWERS = 10 // 少於這個題數不算能力值（太少題，正確率沒有意義）
export const PASS_RATE = 60 // 及格線：醫師一階總分 60 分

export interface Ability {
  subject: string
  answered: number // 作答次數（同一題同一天只算一次）
  covered: number // 寫過的不同題目
  total: number // 題庫裡這一科的題數
  rate: number | null // 最近 RECENT 題的正確率（%），題數不夠時是 null
  change: number | null // 和再之前 RECENT 題比，正確率變化（百分點），不夠比時是 null
}

const time = (iso: string) => new Date(iso).getTime()

const rateOf = (rs: AnswerRecord[]) =>
  rs.length >= MIN_ANSWERS ? Math.round((rs.filter((r) => r.correct).length / rs.length) * 100) : null

export function abilities(subjects: string[], records: AnswerRecord[], map: SubjectMap): Ability[] {
  const bySubject = new Map<string, AnswerRecord[]>(subjects.map((s) => [s, []]))
  const sorted = [...records].sort((a, b) => time(a.answered_at) - time(b.answered_at))
  for (const r of dailyFirsts(sorted)) bySubject.get(map.of(r.question_id) ?? '')?.push(r)

  return subjects.map((subject) => {
    const rs = bySubject.get(subject)!
    const rate = rateOf(rs.slice(-RECENT))
    const before = rateOf(rs.slice(-2 * RECENT, -RECENT))
    return {
      subject,
      answered: rs.length,
      covered: new Set(rs.map((r) => r.question_id)).size,
      total: map.total(subject),
      rate,
      change: rate !== null && before !== null ? rate - before : null,
    }
  })
}

/** 能力值的等級，像模擬經營遊戲的評價 */
export function grade(rate: number): string {
  return rate >= 85 ? 'S' : rate >= 75 ? 'A' : rate >= 65 ? 'B' : rate >= PASS_RATE ? 'C' : rate >= 45 ? 'D' : 'E'
}

/** 最需要加強的學科：有能力值的取最低；都還沒有能力值時，取寫最少的 */
export function weakest(list: Ability[]): Ability | undefined {
  const rated = list.filter((a) => a.rate !== null)
  const pool = rated.length ? rated : list
  const key = (a: Ability) => (rated.length ? a.rate! : a.answered)
  return pool.reduce<Ability | undefined>((min, a) => (!min || key(a) < key(min) ? a : min), undefined)
}
