import { useSyncExternalStore } from 'react'
import { fetchAllPages, supabase } from './supabase'
import { countAnswers } from './usage'
import {
  decodeAnswers, decodeLegacyAnswers, encodeAnswers, nextCursor, syncPlan, type StoredAnswer, type SyncCursor,
} from './answerStorage'
import type { Letter } from './types'

// 作答紀錄：先寫進瀏覽器（離線也能刷），登入後再和 Supabase 雙向同步。
// 每筆有前端產生的 id，重送不會重複；紀錄只增不改。

export type AnswerRecord = StoredAnswer

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

const ANON = 'anon'
const PUSH_BATCH = 500
const PUSH_DELAY_MS = 2000

// v2 是精簡格式（answerStorage.ts）；v1 是舊版的 JSON，讀到就轉成 v2
const storageKey = (owner: string) => `nmle.answers.v2.${owner}`
const legacyKey = (owner: string) => `nmle.answers.v1.${owner}`
// 增量同步的游標（answerStorage.ts 的 syncPlan）。紀錄存不進瀏覽器時要清掉，否則下次會以為已經拉過
const cursorKey = (owner: string) => `nmle.answers.cursor.v1.${owner}`

function readCursor(owner: string): SyncCursor | null {
  try {
    return JSON.parse(localStorage.getItem(cursorKey(owner)) ?? 'null') as SyncCursor | null
  } catch {
    return null
  }
}

function writeCursor(owner: string, cursor: SyncCursor | null) {
  try {
    if (cursor) localStorage.setItem(cursorKey(owner), JSON.stringify(cursor))
    else localStorage.removeItem(cursorKey(owner))
  } catch {
    // 存不了就每次都完整同步
  }
}

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
  // 登入時併進帳號的「這台裝置上沒登入時的作答」有幾題，畫面上提醒一次（共用電腦上可能是別人寫的）
  mergedFromAnon: number
}

let state: State = { owner: ANON, records: load(ANON), status: 'local', error: null, storageFull: false, mergedFromAnon: 0 }
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
  let merged = 0
  if (owner !== ANON) {
    const anon = load(ANON)
    if (anon.length) {
      const ids = new Set(records.map((r) => r.id))
      const added = anon.filter((r) => !ids.has(r.id))
      merged = added.length
      records = [...records, ...added.map((r) => ({ ...r, synced: false }))]
      save(owner, records)
      save(ANON, [])
    }
  }
  state = {
    owner, records, status: owner === ANON ? 'local' : 'syncing', error: null,
    storageFull: !save(owner, records), mergedFromAnon: merged,
  }
  listeners.forEach((l) => l())
  if (owner !== ANON) await syncNow()
}

/** 先把雲端的紀錄拉下來合併（只拉上次之後的，每天一次全部），再把本機還沒上傳的推上去。 */
export async function syncNow() {
  const owner = state.owner
  if (owner === ANON) return
  if (!navigator.onLine) {
    setState({ status: 'offline' })
    return
  }
  setState({ status: 'syncing', error: null })
  try {
    const cursor = readCursor(owner)
    const { since } = syncPlan(cursor)
    const remote = await pull(since)
    if (state.owner !== owner) return // 同步途中換了帳號
    const known = new Map(state.records.map((r) => [r.id, r]))
    // 資料庫回傳的時間格式是 +00:00，統一成前端的 ISO 格式，才能直接比較字串
    for (const { synced_at: _, ...r } of remote) {
      known.set(r.id, { ...r, answered_at: new Date(r.answered_at).toISOString(), synced: true })
    }
    const merged = [...known.values()].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
    setState({ records: merged })
    writeCursor(owner, state.storageFull ? null : nextCursor(cursor, remote.map((r) => r.synced_at), since === null))
    await pushPending()
    if (state.owner === owner) setState({ status: 'synced' })
  } catch (e) {
    if (state.owner === owner) setState({ status: navigator.onLine ? 'error' : 'offline', error: String(e) })
  }
}

type RemoteAnswer = Omit<AnswerRecord, 'synced'> & { synced_at: string }

/** since 為 null：全部；否則只拉 synced_at 比它新的。用 synced_at 排序，分頁途中有新紀錄進來也只會排在最後 */
function pull(since: string | null): Promise<RemoteAnswer[]> {
  return fetchAllPages<RemoteAnswer>((from, to) => {
    let q = supabase.from('answers').select('id, question_id, picked, correct, answered_at, synced_at')
    if (since) q = q.gt('synced_at', since)
    return q.order('synced_at').order('id').range(from, to)
  })
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

/** 看過「已併入幾題」的提醒 */
export function dismissMerged() {
  setState({ mergedFromAnon: 0 })
}

/**
 * 登出後呼叫（這時擁有者已經換成 anon）：這個帳號在這台裝置上只留還沒同步的紀錄，
 * 共用電腦的下一個人看不到；下次登入會再從雲端拉下來，沒同步的也會接著上傳。
 */
export function keepUnsyncedAnswers(userId: string) {
  writeCursor(userId, null) // 已同步的紀錄清掉了，下次登入要全部重拉
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
