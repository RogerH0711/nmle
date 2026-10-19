import type { AnswerRecord } from './answers'
import type { SubjectMap } from './affection'
import { localDate } from './review.ts'

// 學姊傳訊息：打開網站時依作答紀錄判斷，用聊天訊息的樣子提醒（見 plan.md「遊戲介面方向」第 4 點）。
// 網站做不到手機推播，所以只在打開網站時「收到」。訊息內容存在這台裝置，不同步。
// - review：今天有到期的錯題，由到期題數最多的學科的負責學姊傳
// - comeback：超過 COMEBACK_DAYS 天沒作答，由最後寫的那題的學科的負責學姊傳
// - story：有已解鎖、還沒看的劇情（初識除外，初識在地圖上就看得到），由那位學姊傳
// - streak：連續作答天數達到 STREAK_MILESTONES，由今天寫最多題的學科的負責學姊傳
// 每則訊息有固定的 key，同一件事只會傳一次。

export type MessageKind = 'review' | 'comeback' | 'story' | 'streak'

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100]
export const STREAK_MIN_DAILY = 10 // 一天至少寫幾題才算一天（同排行榜的連續作答天數）

export interface MessageEvent {
  key: string // 去重用：同一個 key 只傳一次
  kind: MessageKind
  character: string
  vars: Record<string, string | number> // 帶入台詞的變數，例如 {n}、{days}
}

interface Who {
  id: string
  subjects: string[]
}

const ymd = (date: string) => date.split('-').map(Number) as [number, number, number]

/** 兩個本地日期（YYYY-MM-DD）差幾天 */
function daysBetween(from: string, to: string) {
  const utc = (date: string) => {
    const [y, m, d] = ymd(date)
    return Date.UTC(y, m - 1, d)
  }
  return (utc(to) - utc(from)) / 86_400_000
}

/** 學科 → 負責的學姊；找不到就是 undefined */
function ownerOf<C extends Who>(characters: C[], subject: string | null) {
  return subject ? characters.find((c) => c.subjects.includes(subject)) : undefined
}

/** 依各學科的數量，找數量加起來最多的學姊 */
function topOwner<C extends Who>(characters: C[], counts: Map<string, number>) {
  let best: { c: C; n: number } | undefined
  for (const c of characters) {
    const n = c.subjects.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0)
    if (n > 0 && (!best || n > best.n)) best = { c, n }
  }
  return best?.c
}

/** 連續作答天數：一天至少 STREAK_MIN_DAILY 題，到 today 為止（today 沒達標就是 0） */
export function streakDays(records: Pick<AnswerRecord, 'answered_at'>[], today = localDate()) {
  const perDay = new Map<string, number>()
  for (const r of records) {
    const d = localDate(new Date(r.answered_at))
    perDay.set(d, (perDay.get(d) ?? 0) + 1)
  }
  const [y, m, d] = ymd(today)
  for (let n = 0; ; n++) {
    if ((perDay.get(localDate(new Date(y, m - 1, d - n))) ?? 0) < STREAK_MIN_DAILY) return n
  }
}

export function messageEvents<C extends Who>(input: {
  characters: C[]
  records: AnswerRecord[] // 作答紀錄（不用排序）
  dueIds: string[] // 今天到期的錯題
  subjects: SubjectMap
  newScenes: { character: string; stage: number }[] // 已解鎖、還沒看的劇情
  comebackDays: number
  today?: string
}): MessageEvent[] {
  const { characters, records, dueIds, subjects, newScenes, comebackDays } = input
  const today = input.today ?? localDate()
  if (!characters.length) return []
  const events: MessageEvent[] = []

  // 久沒上線：最後一次作答的日期離今天超過 comebackDays 天
  const last = records.reduce<AnswerRecord | null>((m, r) => (!m || r.answered_at > m.answered_at ? r : m), null)
  if (last) {
    const lastDay = localDate(new Date(last.answered_at))
    const gap = daysBetween(lastDay, today)
    if (gap > comebackDays) {
      const c = ownerOf(characters, subjects.of(last.question_id)) ?? characters[0]
      events.push({ key: `comeback:${lastDay}`, kind: 'comeback', character: c.id, vars: { days: gap } })
    }
  }

  // 錯題到期
  if (dueIds.length) {
    const counts = new Map<string, number>()
    for (const id of dueIds) {
      const s = subjects.of(id)
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const c = topOwner(characters, counts) ?? characters[0]
    events.push({ key: `review:${today}`, kind: 'review', character: c.id, vars: { n: dueIds.length } })
  }

  // 新劇情（初識在地圖上就看得到，不另外傳）
  for (const s of newScenes) {
    if (s.stage >= 1) events.push({ key: `story:${s.character}-${s.stage}`, kind: 'story', character: s.character, vars: {} })
  }

  // 連續作答：今天剛好達到某個里程碑
  const days = streakDays(records, today)
  if (STREAK_MILESTONES.includes(days)) {
    const counts = new Map<string, number>()
    for (const r of records) {
      if (localDate(new Date(r.answered_at)) !== today) continue
      const s = subjects.of(r.question_id)
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const c = topOwner(characters, counts) ?? characters[0]
    events.push({ key: `streak:${days}:${today}`, kind: 'streak', character: c.id, vars: { days } })
  }

  return events
}

// ---------- 收到的訊息（存在這台裝置） ----------

export interface Message {
  key: string
  kind: MessageKind
  character: string
  text: string
  expression: string
  at: string // ISO 時間
  read: boolean
}

const STORE_KEY = 'nmle.messages.v1'
const KEEP = 200 // 最多留幾則，太舊的丟掉

export function loadMessages(): Message[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Message[]
  } catch {
    return []
  }
}

export function saveMessages(list: Message[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-KEEP)))
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

/** 訊息種類 → 台詞的情境（data/lines/<角色>.json 的 situation） */
export const MESSAGE_SITUATION = {
  review: 'msg_review',
  comeback: 'msg_comeback',
  story: 'msg_story',
  streak: 'msg_streak',
} as const

/** 把 {n}、{days} 這類變數換成實際的值（{player} 由 fillPlayer 處理） */
export function fillVars(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}
