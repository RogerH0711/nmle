import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { countAnswers } from './usage'
import { decodeAnswers, decodeLegacyAnswers, encodeAnswers, type StoredAnswer } from './answerStorage'
import type { Letter } from './types'

// 作答紀錄：先寫進瀏覽器（離線也能刷），登入後再和 Supabase 雙向同步。
// 每筆有前端產生的 id，重送不會重複；紀錄只增不改。

export type AnswerRecord = StoredAnswer

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

const ANON = 'anon'
const PAGE_SIZE = 1000
const PUSH_BATCH = 500
const PUSH_DELAY_MS = 2000

// v2 是精簡格式（answerStorage.ts）；v1 是舊版的 JSON，讀到就轉成 v2
const storageKey = (owner: string) => `nmle.answers.v2.${owner}`
const legacyKey = (owner: string) => `nmle.answers.v1.${owner}`

function load(owner: string): AnswerRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(owner))
    if (raw !== null) return decodeAnswers(raw)
    const legacy = localStorage.getItem(legacyKey(owner))
    if (legacy === null) return []
    const records = decodeLegacyAnswers(legacy)
    // 先刪舊的再存：舊的可能就是把空間塞滿的原因，新格式比較小，騰出空間一定存得進去；萬一失敗就放回去
    localStorage.removeItem(legacyKey(owner))
    if (!save(owner, records)) localStorage.setItem(legacyKey(owner), legacy)
    return records
  } catch {
    return []
  }
}

/** 存進瀏覽器；存不進去（容量滿了、無痕模式）回傳 false */
function save(owner: string, records: AnswerRecord[]): boolean {
  try {
    localStorage.setItem(storageKey(owner), encodeAnswers(records))
    return true
  } catch {
    // 這次瀏覽仍保留在記憶體，登入的話也會同步到雲端；畫面上會提醒（storageFull）
    return false
  }
}

interface State {
  owner: string // 使用者 id；未登入為 anon
  records: AnswerRecord[]
  status: SyncStatus
  error: string | null
  storageFull: boolean // 最近一次存進瀏覽器失敗：重新整理後，沒同步到雲端的紀錄會不見
}

let state: State = { owner: ANON, records: load(ANON), status: 'local', error: null, storageFull: false }
const listeners = new Set<() => void>()
let pushTimer: ReturnType<typeof setTimeout> | undefined

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  if (patch.records) state = { ...state, storageFull: !save(state.owner, state.records) }
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
  state = { owner, records, status: owner === ANON ? 'local' : 'syncing', error: null, storageFull: !save(owner, records) }
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
    // 資料庫回傳的時間格式是 +00:00，統一成前端的 ISO 格式，才能直接比較字串
    for (const r of remote) known.set(r.id, { ...r, answered_at: new Date(r.answered_at).toISOString(), synced: true })
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

/**
 * 登出後呼叫（這時擁有者已經換成 anon）：這個帳號在這台裝置上只留還沒同步的紀錄，
 * 共用電腦的下一個人看不到；下次登入會再從雲端拉下來，沒同步的也會接著上傳。
 */
export function keepUnsyncedAnswers(userId: string) {
  const unsynced = load(userId).filter((r) => !r.synced)
  if (unsynced.length) save(userId, unsynced)
  else {
    try {
      localStorage.removeItem(storageKey(userId))
    } catch {
      // 讀不到瀏覽器儲存空間就算了
    }
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
