// 收藏、不確定、筆記（不依賴瀏覽器環境，方便測試）。儲存與同步在 marksStore.ts，資料庫是 question_marks
// （supabase/migrations/20261120000000_question_marks.sql）。做法見 docs/design.md「技術架構」的收藏與筆記。
//
// - 每題一筆，會改來改去（取消收藏、改筆記），不像作答紀錄只增不改。兩台裝置都改過時，改的時間（updated_at）新的贏。
// - 不確定：答對但沒把握的題目，放在圖書館的「不確定」清單。之後再答一次就移出（答錯會進錯題複習），
//   答對但還是沒把握就再按一次。
// - 全部取消的那筆不刪，留著讓別台裝置同步時知道已經取消了。

export const NOTE_MAX = 2000

export interface Mark {
  favorite: boolean
  unsure: boolean
  note: string | null
  updated_at: string // ISO，前端改的時間
  synced: boolean
}

export type Marks = Record<string, Mark> // 題目 id → 那題的標記

export type MarkPatch = Partial<Pick<Mark, 'favorite' | 'unsure' | 'note'>>

const EMPTY = { favorite: false, unsure: false, note: null } as const

export function normalizeNote(note: string | null | undefined): string | null {
  const t = (note ?? '').trim().slice(0, NOTE_MAX)
  return t || null
}

export function markOf(marks: Marks, questionId: string): Pick<Mark, 'favorite' | 'unsure' | 'note'> {
  return marks[questionId] ?? EMPTY
}

/** 改一題的標記；沒有變就回傳原本的物件（不用存檔、不用同步） */
export function setMark(marks: Marks, questionId: string, patch: MarkPatch, now = new Date()): Marks {
  const cur = markOf(marks, questionId)
  const next = {
    favorite: patch.favorite ?? cur.favorite,
    unsure: patch.unsure ?? cur.unsure,
    note: 'note' in patch ? normalizeNote(patch.note) : cur.note,
  }
  if (next.favorite === cur.favorite && next.unsure === cur.unsure && next.note === cur.note) return marks
  return { ...marks, [questionId]: { ...next, updated_at: now.toISOString(), synced: false } }
}

/**
 * 合併兩份（別的分頁、雲端、備份檔）：每題取改的時間比較新的那筆。
 * 時間一樣（同一筆）時，只要一邊已同步就算已同步。沒有任何改變回傳 null。
 */
export function mergeMarks(current: Marks, incoming: Marks): Marks | null {
  let out: Marks | null = null
  for (const [id, m] of Object.entries(incoming)) {
    const mine = current[id]
    let pick: Mark | null = null
    if (!mine || m.updated_at > mine.updated_at) pick = m
    else if (m.updated_at === mine.updated_at && m.synced && !mine.synced) pick = { ...mine, synced: true }
    if (pick) {
      out ??= { ...current }
      out[id] = pick
    }
  }
  return out
}

/** 清單裡的題目 id（依題號排序），kind：收藏或不確定 */
export function listOf(marks: Marks, kind: 'favorite' | 'unsure'): string[] {
  return Object.keys(marks)
    .filter((id) => marks[id][kind])
    .sort()
}

/** 有筆記的題目數（使用說明、題庫篩選用） */
export const noteCount = (marks: Marks) => Object.values(marks).filter((m) => m.note).length
