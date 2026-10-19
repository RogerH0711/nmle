import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { countAnswers } from './usage'
import type { Letter } from './types'

// 作答紀錄：先寫進瀏覽器（離線也能刷），登入後再和 Supabase 雙向同步。
// 每筆有前端產生的 id，重送不會重複；紀錄只增不改。

export interface AnswerRecord {
  id: string
  question_id: string
  picked: Letter
  correct: boolean
  answered_at: string // ISO 時間
  synced: boolean
}

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

const ANON = 'anon'
const PAGE_SIZE = 1000
const PUSH_BATCH = 500
const PUSH_DELAY_MS = 2000

const storageKey = (owner: string) => `nmle.answers.v1.${owner}`

function load(owner: string): AnswerRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(owner))
    return raw ? (JSON.parse(raw) as AnswerRecord[]) : []
  } catch {
    return []
  }
}

function save(owner: string, records: AnswerRecord[]) {
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(records))
  } catch {
    // 無痕模式或容量滿了：這次瀏覽仍保留在記憶體，登入的話也已同步到雲端
  }
}

interface State {
  owner: string // 使用者 id；未登入為 anon
  records: AnswerRecord[]
  status: SyncStatus
  error: string | null
}

let state: State = { owner: ANON, records: load(ANON), status: 'local', error: null }
const listeners = new Set<() => void>()
let pushTimer: ReturnType<typeof setTimeout> | undefined

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  if (patch.records) save(state.owner, state.records)
  listeners.forEach((l) => l())
}

export function useAnswers() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function recordAnswer(questionId: string, picked: Letter, correct: boolean) {
  recordAnswers([{ questionId, picked, correct }])
}

/** 一次寫入多筆（模擬考交卷時用），只存一次 localStorage。 */
export function recordAnswers(
  items: { questionId: string; picked: Letter; correct: boolean }[],
  answeredAt = new Date().toISOString(),
) {
  if (!items.length) return
  const added: AnswerRecord[] = items.map((x) => ({
    id: crypto.randomUUID(),
    question_id: x.questionId,
    picked: x.picked,
    correct: x.correct,
    answered_at: answeredAt,
    synced: false,
  }))
  setState({ records: [...state.records, ...added] })
  countAnswers(added.length) // 匿名使用統計：只算在這台裝置作答的
  if (state.owner !== ANON) schedulePush()
}

/** 登入狀態改變時呼叫：切換到該使用者的紀錄，並把登入前在這台裝置刷的題目併進帳號。 */
export async function switchUser(userId: string | null) {
  const owner = userId ?? ANON
  if (owner === state.owner) return
  clearTimeout(pushTimer)

  let records = load(owner)
  if (owner !== ANON) {
    const anon = load(ANON)
    if (anon.length) {
      const ids = new Set(records.map((r) => r.id))
      records = [...records, ...anon.filter((r) => !ids.has(r.id)).map((r) => ({ ...r, synced: false }))]
      save(owner, records)
      save(ANON, [])
    }
  }
  state = { owner, records, status: owner === ANON ? 'local' : 'syncing', error: null }
  save(owner, records)
  listeners.forEach((l) => l())
  if (owner !== ANON) await syncNow()
}

/** 先把雲端的紀錄拉下來合併，再把本機還沒上傳的推上去。 */
export async function syncNow() {
  const owner = state.owner
  if (owner === ANON) return
  if (!navigator.onLine) {
    setState({ status: 'offline' })
    return
  }
  setState({ status: 'syncing', error: null })
  try {
    const remote = await pullAll()
    if (state.owner !== owner) return // 同步途中換了帳號
    const known = new Map(state.records.map((r) => [r.id, r]))
    for (const r of remote) known.set(r.id, { ...r, synced: true })
    const merged = [...known.values()].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
    setState({ records: merged })
    await pushPending()
    if (state.owner === owner) setState({ status: 'synced' })
  } catch (e) {
    if (state.owner === owner) setState({ status: navigator.onLine ? 'error' : 'offline', error: String(e) })
  }
}

async function pullAll(): Promise<Omit<AnswerRecord, 'synced'>[]> {
  const rows: Omit<AnswerRecord, 'synced'>[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('answers')
      .select('id, question_id, picked, correct, answered_at')
      .order('answered_at')
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data as Omit<AnswerRecord, 'synced'>[]))
    if (data.length < PAGE_SIZE) return rows
  }
}

async function pushPending() {
  const owner = state.owner
  const pending = state.records.filter((r) => !r.synced)
  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    if (state.owner !== owner) return // 上傳途中換了帳號
    const batch = pending.slice(i, i + PUSH_BATCH)
    const { error } = await supabase
      .from('answers')
      .upsert(
        batch.map(({ synced: _, ...r }) => r),
        { onConflict: 'id', ignoreDuplicates: true },
      )
    if (error) throw new Error(error.message)
    if (state.owner !== owner) return
    const done = new Set(batch.map((r) => r.id))
    setState({ records: state.records.map((r) => (done.has(r.id) ? { ...r, synced: true } : r)) })
  }
}

function schedulePush() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    if (state.owner === ANON || !navigator.onLine) {
      if (state.owner !== ANON) setState({ status: 'offline' })
      return
    }
    const owner = state.owner
    setState({ status: 'syncing', error: null })
    try {
      await pushPending()
      if (state.owner === owner) setState({ status: 'synced' })
    } catch (e) {
      if (state.owner === owner) setState({ status: navigator.onLine ? 'error' : 'offline', error: String(e) })
    }
  }, PUSH_DELAY_MS)
}

window.addEventListener('online', () => {
  if (state.owner !== ANON) void syncNow()
})
