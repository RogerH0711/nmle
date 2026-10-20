import { useSyncExternalStore } from 'react'
import { dataUrl } from './bank'
import { supabase } from './supabase'
import type { GiftCatalog, GiftRecord } from './shop'

// 送禮紀錄的本機儲存與同步，做法同 mockStore.ts：
// 先存本機，登入後和 Supabase 的 gifts 雙向同步；紀錄只增不改。書籤餘額由作答紀錄和這份紀錄推算（shop.ts）。

const ANON = 'anon'
const recordsKey = (owner: string) => `nmle.gifts.v1.${owner}`

let catalog: Promise<GiftCatalog> | null = null
export function loadGifts(): Promise<GiftCatalog> {
  catalog ??= fetch(dataUrl('gifts.json'))
    .then((r) => (r.ok ? (r.json() as Promise<GiftCatalog>) : { gifts: [], likes: {} }))
    .catch(() => ({ gifts: [], likes: {} }))
  return catalog
}

function read(owner: string): GiftRecord[] {
  try {
    const raw = localStorage.getItem(recordsKey(owner))
    return raw ? (JSON.parse(raw) as GiftRecord[]) : []
  } catch {
    return []
  }
}

function write(owner: string, records: GiftRecord[]) {
  try {
    localStorage.setItem(recordsKey(owner), JSON.stringify(records))
  } catch {
    // 無痕模式等情況存不了，就只在這次瀏覽有效
  }
}

interface State {
  owner: string
  records: GiftRecord[]
  error: string | null
}

let state: State = { owner: ANON, records: read(ANON), error: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  if (patch.records) write(state.owner, state.records)
  listeners.forEach((l) => l())
}

export function useGifts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function addGift(record: Omit<GiftRecord, 'synced'>) {
  setState({ records: [...state.records, { ...record, synced: false }] })
  if (state.owner !== ANON) void syncGifts()
}

/** 登入狀態改變時呼叫：切換到該使用者的紀錄，並把登入前在這台裝置送的併進帳號。 */
export async function switchGiftUser(userId: string | null) {
  const owner = userId ?? ANON
  if (owner === state.owner) return
  let records = read(owner)
  if (owner !== ANON) {
    const anon = read(ANON)
    if (anon.length) {
      const ids = new Set(records.map((r) => r.id))
      records = [...records, ...anon.filter((r) => !ids.has(r.id)).map((r) => ({ ...r, synced: false }))]
      write(ANON, [])
    }
  }
  state = { owner, records, error: null }
  write(owner, records)
  listeners.forEach((l) => l())
  if (owner !== ANON) await syncGifts()
}

/** 先拉雲端的紀錄合併，再把還沒上傳的推上去。 */
export async function syncGifts() {
  const owner = state.owner
  if (owner === ANON || !navigator.onLine) return
  try {
    const { data, error } = await supabase
      .from('gifts')
      .select('id, character_id, gift_id, price, stage, line_id, given_at')
      .order('given_at')
    if (error) throw new Error(error.message)
    if (state.owner !== owner) return
    const known = new Map(state.records.map((r) => [r.id, r]))
    // 資料庫回傳的時間格式是 +00:00，統一成前端的 ISO 格式
    for (const r of data as Omit<GiftRecord, 'synced'>[]) {
      known.set(r.id, { ...r, given_at: new Date(r.given_at).toISOString(), synced: true })
    }
    setState({ records: [...known.values()].sort((a, b) => a.given_at.localeCompare(b.given_at)), error: null })

    const pending = state.records.filter((r) => !r.synced)
    if (!pending.length) return
    const { error: pushError } = await supabase
      .from('gifts')
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
  if (state.owner !== ANON) void syncGifts()
})
