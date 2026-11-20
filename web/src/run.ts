// 一回合的資料與純函式（不依賴 React，方便測試）。App.tsx 用它決定題目順序、記錄作答、算這回合的成績。
import type { Letter, PaperInfo, Question } from './types'
import { makeOrder, type Order as OptionOrder } from './options.ts'

export type Order = 'seq' | 'random'

// 一回合：依考卷刷題（paper）、錯題複習（review）、跟角色讀書（character，subject 存角色 id）、
// 檢討模擬考（mock，picks 預先填入交卷時的答案）、刷題庫搜尋找到的題目（bank，subject 存搜尋條件的說明）
// 或圖書館的清單（list，subject 是 unsure 或 favorite，見 Library.tsx）。
// 題目可以跨考卷，用題目 id 串起來。存在 localStorage，重新整理不會不見。
export interface Run {
  kind: 'paper' | 'review' | 'character' | 'mock' | 'bank' | 'list'
  paperId: string | null
  subject: string
  order: Order
  queue: string[]
  pos: number
  picks: Record<string, Letter> // 原本的字母（選項打亂時也是）
  affection?: number // 角色回合開始時的好感度階段，回合結束時比較有沒有升階
  orders?: Record<string, OptionOrder> // 每題畫面上的選項順序（options.ts），回合開始時決定，重新整理不會變
}

const RUN_KEY = 'nmle.run.v2'

export function loadRun(): Run | null {
  try {
    const raw = localStorage.getItem(RUN_KEY)
    return raw ? (JSON.parse(raw) as Run) : null
  } catch {
    return null
  }
}

export function saveRun(run: Run) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run))
  } catch {
    // 無痕模式等情況存不了，就只在這次瀏覽有效
  }
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 替還沒決定選項順序的題目打亂選項。檢討模擬考維持考卷原本的順序，跟交卷時看到的一樣。
export function withOrders(run: Run, questions: Map<string, Question>): Run {
  if (run.kind === 'mock') return run
  const orders = { ...run.orders }
  for (const id of run.queue) {
    const q = questions.get(id)
    if (q && !orders[id]) orders[id] = makeOrder(q)
  }
  return { ...run, orders }
}

export function isCorrect(q: Question, pick: Letter) {
  return q.free_point || q.answers.includes(pick)
}

export function paperQueue(questions: Question[], subject: string, order: Order) {
  const ids = questions.filter((q) => q.valid && (subject === 'all' || q.subject === subject)).map((q) => q.id)
  return order === 'random' ? shuffle(ids) : ids
}

/** 這回合已作答幾題、答對幾題 */
export function runStats(run: Run | null, questions: Map<string, Question>) {
  let answered = 0
  let correct = 0
  for (const id of run?.queue ?? []) {
    const q = questions.get(id)
    const p = run?.picks[id]
    if (q && p) {
      answered++
      if (isCorrect(q, p)) correct++
    }
  }
  return { answered, correct }
}

/** 這回合答錯的題目（照回合裡的順序），「重做錯題」用 */
export function wrongIds(run: Run, questions: Map<string, Question>) {
  return run.queue.filter((id) => {
    const q = questions.get(id)
    const p = run.picks[id]
    return !!q && !!p && !isCorrect(q, p)
  })
}

/**
 * 和學姊讀書的題目：她負責學科的所有題號，由 index.json 的學科區段（subject_runs）算出來，不用先載入考卷。
 * 題庫有 42 份考卷，全部載入要 3 MB 多，抽到哪幾題再載入那幾份就好。
 */
export function subjectQuestionIds(papers: Pick<PaperInfo, 'id' | 'subject_runs'>[], subjects: string[]): string[] {
  const ids: string[] = []
  for (const p of papers) {
    for (const [lo, hi, s] of p.subject_runs ?? []) {
      if (!subjects.includes(s)) continue
      for (let n = lo; n <= hi; n++) ids.push(`${p.id}_${String(n).padStart(3, '0')}`)
    }
  }
  return ids
}

/** 抽一回合：沒寫過的優先，各自打亂 */
export function pickRound(ids: string[], answered: Set<string>, size: number): string[] {
  return [...shuffle(ids.filter((id) => !answered.has(id))), ...shuffle(ids.filter((id) => answered.has(id)))].slice(0, size)
}
