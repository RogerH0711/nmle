import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { MockRecord, MockSession } from './mock'

// 模擬考的本機儲存與同步，做法同 answers.ts：
// - 作答中的模擬考只存在這台裝置，重新整理、關掉分頁再打開都能接著考，計時不會停。
// - 交卷後的紀錄先存本機，登入後和 Supabase 的 mock_exams 雙向同步；紀錄只增不改。

const ANON = 'anon'
const SESSION_KEY = 'nmle.mock.session.v1'
const recordsKey = (owner: string) => `nmle.mocks.v1.${owner}`

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 無痕模式等情況存不了，就只在這次瀏覽有效
  }
}

// ---------- 作答中的模擬考 ----------

export const loadSession = () => read<MockSession | null>(SESSION_KEY, null)
export const saveSession = (s: MockSession | null) => write(SESSION_KEY, s)

// ---------- 交卷後的紀錄 ----------

interface State {
  owner: string
  records: MockRecord[]
  error: string | null
}

let state: State = { owner: ANON, records: read<MockRecord[]>(recordsKey(ANON), []), error: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  if (patch.records) write(recordsKey(state.owner), state.records)
  listeners.forEach((l) => l())
}

export function useMocks() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function addMock(record: Omit<MockRecord, 'synced'>) {
  setState({ records: [...state.records, { ...record, synced: false }] })
  if (state.owner !== ANON) void syncMocks()
}

/** 登入狀態改變時呼叫：切換到該使用者的紀錄，並把登入前在這台裝置考的併進帳號。 */
export async function switchMockUser(userId: string | null) {
  const owner = userId ?? ANON
  if (owner === state.owner) return
  let records = read<MockRecord[]>(recordsKey(owner), [])
  if (owner !== ANON) {
    const anon = read<MockRecord[]>(recordsKey(ANON), [])
    if (anon.length) {
      const ids = new Set(records.map((r) => r.id))
      records = [...records, ...anon.filter((r) => !ids.has(r.id)).map((r) => ({ ...r, synced: false }))]
      write(recordsKey(ANON), [])
    }
  }
  state = { owner, records, error: null }
  write(recordsKey(owner), records)
  listeners.forEach((l) => l())
  if (owner !== ANON) await syncMocks()
}

/** 登出後呼叫（擁有者已經換成 anon）：這個帳號在這台裝置上只留還沒同步的模擬考，做法同 answers.ts */
export function keepUnsyncedMocks(userId: string) {
  const unsynced = read<MockRecord[]>(recordsKey(userId), []).filter((r) => !r.synced)
  write(recordsKey(userId), unsynced.length ? unsynced : null)
}

/** 先拉雲端的紀錄合併，再把還沒上傳的推上去。 */
export async function syncMocks() {
  const owner = state.owner
  if (owner === ANON || !navigator.onLine) return
  try {
    const { data, error } = await supabase
      .from('mock_exams')
      .select('id, paper_id, started_at, submitted_at, picks')
      .order('started_at')
    if (error) throw new Error(error.message)
    if (state.owner !== owner) return
    const known = new Map(state.records.map((r) => [r.id, r]))
    // 資料庫回傳的時間格式是 +00:00，統一成前端的 ISO 格式，才能直接比較字串
    const iso = (t: string) => new Date(t).toISOString()
    for (const r of data as Omit<MockRecord, 'synced'>[]) {
      known.set(r.id, { ...r, started_at: iso(r.started_at), submitted_at: iso(r.submitted_at), synced: true })
    }
    setState({ records: [...known.values()].sort((a, b) => a.started_at.localeCompare(b.started_at)), error: null })

    const pending = state.records.filter((r) => !r.synced)
    if (!pending.length) return
    const { error: pushError } = await supabase
      .from('mock_exams')
      .upsert(
        pending.map(({ synced: _, ...r }) => r),
        { onConflict: 'id', ignoreDuplicates: true },
      )
    if (pushError) throw new Error(pushError.message)
    if (state.owner !== owner) return
    const done = new Set(pending.map((r) => r.id))
    setState({ records: state.records.map((r) => (done.has(r.id) ? { ...r, synced: true } : r)) })
  } catch (e) {
    if (state.owner === owner) setState({ error: String(e) })
  }
}

window.addEventListener('online', () => {
  if (state.owner !== ANON) void syncMocks()
})
