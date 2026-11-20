import { useSyncExternalStore } from 'react'
import { fetchAllPages, supabase } from './supabase'
import { mergeMarks, setMark, type Mark, type MarkPatch, type Marks } from './marks'

// 收藏、不確定、筆記的本機儲存與同步（規則在 marks.ts）。做法同 giftStore.ts：
// 先存本機（沒登入也能用），登入後和 Supabase 的 question_marks 雙向同步。
// 差別是這些會改來改去，所以是「每題一筆、改的時間新的贏」，不是只增不改的紀錄。

const ANON = 'anon'
const PUSH_DELAY_MS = 1500 // 連續按收藏、打筆記時不要每次都送
export const marksKey = (owner: string) => `nmle.marks.v1.${owner}`

function read(owner: string): Marks {
  try {
    return JSON.parse(localStorage.getItem(marksKey(owner)) ?? '{}') as Marks
  } catch {
    return {}
  }
}

function write(owner: string, marks: Marks) {
  try {
    localStorage.setItem(marksKey(owner), JSON.stringify(marks))
  } catch {
    // 無痕模式等情況存不了，就只在這次瀏覽有效
  }
}

interface State {
  owner: string
  marks: Marks
  error: string | null
}

let state: State = { owner: ANON, marks: read(ANON), error: null }
const listeners = new Set<() => void>()
let pushTimer: ReturnType<typeof setTimeout> | undefined

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  if (patch.marks) write(state.owner, state.marks)
  listeners.forEach((l) => l())
}

export function useMarks() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** 改一題的收藏、不確定或筆記 */
export function updateMark(questionId: string, patch: MarkPatch) {
  const next = setMark(state.marks, questionId, patch)
  if (next === state.marks) return
  setState({ marks: next })
  if (state.owner !== ANON) {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(() => void syncMarks(), PUSH_DELAY_MS)
  }
}

/** 登入狀態改變時呼叫：切換到該使用者的標記，並把登入前在這台裝置做的併進帳號（同一題取比較新的）。 */
export async function switchMarksUser(userId: string | null) {
  const owner = userId ?? ANON
  if (owner === state.owner) return
  clearTimeout(pushTimer)
  let marks = read(owner)
  if (owner !== ANON) {
    const anon = read(ANON)
    if (Object.keys(anon).length) {
      const unsynced = Object.fromEntries(Object.entries(anon).map(([id, m]) => [id, { ...m, synced: false }]))
      marks = mergeMarks(marks, unsynced) ?? marks
      write(ANON, {})
    }
  }
  state = { owner, marks, error: null }
  write(owner, marks)
  listeners.forEach((l) => l())
  if (owner !== ANON) await syncMarks()
}

/** 登出後呼叫（擁有者已經換成 anon）：這個帳號在這台裝置上只留還沒同步的，做法同 answers.ts */
export function keepUnsyncedMarks(userId: string) {
  const unsynced = Object.fromEntries(Object.entries(read(userId)).filter(([, m]) => !m.synced))
  try {
    if (Object.keys(unsynced).length) write(userId, unsynced)
    else localStorage.removeItem(marksKey(userId))
  } catch {
    // 讀不到瀏覽器儲存空間就算了
  }
}

type RemoteMark = Omit<Mark, 'synced'> & { question_id: string }

/** 先拉雲端的合併（每題取比較新的），再把還沒上傳的推上去。筆數不多（一個人頂多幾百題），每次都全部拉。 */
export async function syncMarks() {
  const owner = state.owner
  if (owner === ANON || !navigator.onLine) return
  try {
    const rows = await fetchAllPages<RemoteMark>((from, to) =>
      supabase.from('question_marks').select('question_id, favorite, unsure, note, updated_at').order('question_id').range(from, to),
    )
    if (state.owner !== owner) return
    // 資料庫回傳的時間格式是 +00:00，統一成前端的 ISO 格式，才能直接比較字串
    const remote: Marks = Object.fromEntries(
      rows.map(({ question_id, ...m }) => [question_id, { ...m, updated_at: new Date(m.updated_at).toISOString(), synced: true }]),
    )
    const merged = mergeMarks(state.marks, remote)
    if (merged) setState({ marks: merged })

    const pending = Object.entries(state.marks).filter(([, m]) => !m.synced)
    if (!pending.length) return setState({ error: null })
    const { error } = await supabase.from('question_marks').upsert(
      pending.map(([question_id, m]) => ({
        user_id: owner, question_id, favorite: m.favorite, unsure: m.unsure, note: m.note, updated_at: m.updated_at,
      })),
      { onConflict: 'user_id,question_id' },
    )
    if (error) throw new Error(error.message)
    if (state.owner !== owner) return
    // 上傳途中又改了的那幾題（改的時間不一樣）維持未同步，下次再送
    const sent = new Map(pending.map(([id, m]) => [id, m.updated_at]))
    const marks = Object.fromEntries(
      Object.entries(state.marks).map(([id, m]) => [id, sent.get(id) === m.updated_at ? { ...m, synced: true } : m]),
    )
    setState({ marks, error: null })
  } catch (e) {
    if (state.owner === owner) setState({ error: String(e) })
  }
}

window.addEventListener('online', () => {
  if (state.owner !== ANON) void syncMarks()
})

// 別的分頁改了標記時併進來，做法同 answers.ts（只更新記憶體，不寫回去）
window.addEventListener('storage', (e) => {
  if (e.key !== marksKey(state.owner) || e.newValue === null) return
  let incoming: Marks
  try {
    incoming = JSON.parse(e.newValue) as Marks
  } catch {
    return
  }
  const merged = mergeMarks(state.marks, incoming)
  if (!merged) return
  state = { ...state, marks: merged }
  listeners.forEach((l) => l())
})
