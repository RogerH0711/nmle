import type { Letter, Question } from './types'

// 模擬考：一份考卷限時作答、交卷才看答案（規則同正式考試：100 題、2 小時）。
// 分數只用題目資料和選的答案算，和資料庫的 leaderboard_mock 同一套規則：
// 官方一律給分的題目不論有沒有作答都給分（包含沒出題的那種），其他題選到正解之一才給分。

export const MOCK_MINUTES = 120
export const PASS_SCORE = 60 // 正式考試是兩科平均 60 分及格，單科只當參考
export const MOCK_HIGH = 70 // 達到這個分數，角色說 mock_high 台詞
export const MIN_RANKED_MINUTES = 10 // 作答不到這麼久就交卷的不列入排行榜（資料庫的 prepare_mock_exam 同一個數字）

/** 作答中的模擬考（只存在這台裝置） */
export interface MockSession {
  id: string
  paperId: string
  startedAt: string // ISO 時間
  picks: Record<string, Letter>
  flags: string[] // 標記「等一下再看」的題目 id
  pos: number
}

/** 交卷後的紀錄（同步到 Supabase 的 mock_exams） */
export interface MockRecord {
  id: string
  paper_id: string
  started_at: string
  submitted_at: string
  picks: Record<string, Letter>
  synced: boolean
}

export interface MockScore {
  score: number
  total: number
  answered: number
  bySubject: Map<string, { total: number; correct: number }>
}

/** 模擬考會出的題目：可作答的題目，依題號排序 */
export function mockQueue(questions: Question[]) {
  return questions.filter((q) => q.valid).sort((a, b) => a.number - b.number).map((q) => q.id)
}

export function isMockCorrect(q: Question, pick: Letter | undefined) {
  return q.free_point || (!!pick && q.answers.includes(pick))
}

export function scoreMock(questions: Question[], picks: Record<string, Letter>): MockScore {
  const bySubject = new Map<string, { total: number; correct: number }>()
  let score = 0
  let total = 0
  let answered = 0
  for (const q of questions) {
    if (!q.valid && !q.free_point) continue // 沒出題也沒給分的題目不算進滿分
    total++
    if (q.valid && picks[q.id]) answered++
    const ok = isMockCorrect(q, picks[q.id])
    if (ok) score++
    if (!q.valid) continue // 沒出題的送分題只加總分，不列進學科
    const key = q.subject ?? 'unknown'
    const row = bySubject.get(key) ?? { total: 0, correct: 0 }
    row.total++
    if (ok) row.correct++
    bySubject.set(key, row)
  }
  return { score, total, answered, bySubject }
}

export function deadline(startedAt: string) {
  return new Date(startedAt).getTime() + MOCK_MINUTES * 60_000
}

/** 交卷時間：時間到之後才交（例如關掉分頁、隔天才打開）就算在時間到的那一刻 */
export function submitTime(startedAt: string, now = Date.now()) {
  return new Date(Math.min(now, deadline(startedAt))).toISOString()
}

/** 1:05:09、4:59 */
export function formatClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** 作答不到 MIN_RANKED_MINUTES 分鐘就交卷：不列入排行榜 */
export function tooQuick(r: { started_at: string; submitted_at: string }) {
  return new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime() < MIN_RANKED_MINUTES * 60_000
}

/** 每份考卷第一次模擬考的紀錄 id（排行榜只採計這些） */
export function firstAttempts(records: MockRecord[]) {
  const first = new Map<string, MockRecord>()
  for (const r of records) {
    const cur = first.get(r.paper_id)
    if (!cur || r.started_at < cur.started_at || (r.started_at === cur.started_at && r.id < cur.id)) {
      first.set(r.paper_id, r)
    }
  }
  return new Set([...first.values()].map((r) => r.id))
}

/**
 * 高分交卷後由哪位角色來說話：這份考卷裡，她負責的學科得分率最高的那位。
 * 得分率一樣時，選題數多的。考卷裡沒有她負責的學科就不算。
 */
export function bestCharacter<C extends { subjects: string[] }>(
  questions: Question[],
  picks: Record<string, Letter>,
  characters: C[],
): C | undefined {
  let best: { c: C; rate: number; total: number } | undefined
  for (const c of characters) {
    const mine = questions.filter((q) => q.valid && q.subject && c.subjects.includes(q.subject))
    if (!mine.length) continue
    const rate = mine.filter((q) => isMockCorrect(q, picks[q.id])).length / mine.length
    if (!best || rate > best.rate || (rate === best.rate && mine.length > best.total)) {
      best = { c, rate, total: mine.length }
    }
  }
  return best?.c
}
