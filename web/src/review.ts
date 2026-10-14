import type { AnswerRecord } from './answers'

// 錯題複習（Leitner box），完全由作答紀錄推算：
// - 答錯：放回第 1 格，隔 INTERVALS[0] 天後到期。
// - 到期當天（或之後）答對：往後移一格，間隔拉長；最後一格再答對就「攻略完成」。
// - 還沒到期就答對不算數；任何時候答錯都回到第 1 格（攻略完成的也一樣）。
export const INTERVALS = [1, 3, 7, 14] // 天

export interface ReviewState {
  box: number // 0 起算
  due: string // YYYY-MM-DD（本地日期）
  done: boolean
}

export function localDate(d: Date = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

export function reviewStates(records: AnswerRecord[]): Map<string, ReviewState> {
  const states = new Map<string, ReviewState>()
  const sorted = [...records].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
  for (const r of sorted) {
    const day = localDate(new Date(r.answered_at))
    const s = states.get(r.question_id)
    if (!r.correct) {
      states.set(r.question_id, { box: 0, due: addDays(day, INTERVALS[0]), done: false })
    } else if (s && !s.done && day >= s.due) {
      if (s.box === INTERVALS.length - 1) states.set(r.question_id, { ...s, done: true })
      else states.set(r.question_id, { box: s.box + 1, due: addDays(day, INTERVALS[s.box + 1]), done: false })
    }
  }
  return states
}

export function reviewSummary(states: Map<string, ReviewState>, today = localDate()) {
  const due: string[] = []
  let waiting = 0
  let done = 0
  for (const [id, s] of states) {
    if (s.done) done++
    else if (s.due <= today) due.push(id)
    else waiting++
  }
  // 拖最久的先複習
  due.sort((a, b) => states.get(a)!.due.localeCompare(states.get(b)!.due))
  return { due, waiting, done }
}
