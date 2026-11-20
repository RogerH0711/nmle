// 備份與搬家：把這台裝置的紀錄（localStorage）下載成一個 JSON 檔，在別的瀏覽器或新網址匯入。
// 為什麼需要：localStorage 綁網址，網站搬到新網域、換瀏覽器、清除瀏覽器資料時，沒登入的人的紀錄就不見了；
// 帳號密碼註冊的人忘記密碼也找不回來。
//
// - 只匯出 nmle. 開頭的鍵。不帶登入權杖（sb- 開頭）、裝置代碼和使用統計（匯入後會變成兩台裝置共用同一個代碼）、
//   增量同步的游標（匯入後讓它重新完整同步一次比較保險）。
// - 匯入是合併，不是覆蓋：作答、模擬考、送禮依 id 合併（重複匯入不會重複計算），看過的劇情、回報過的題目取聯集，
//   訊息依 key 合併，收藏與筆記每題取比較新的；其他（設定、目前這一回合）只在這台裝置還沒有時才補上。
// - 登入時匯出的紀錄存在帳號 id 的鍵底下，匯入後要登入同一個帳號才看得到（登入時會和雲端合併）。
// 這個檔案的函式不依賴瀏覽器環境，方便測試；讀寫 localStorage 的部分在最下面。
import { decodeAnswers, encodeAnswers, type StoredAnswer } from './answerStorage.ts'
import { mergeByKey, mergeRecords } from './merge.ts'
import { mergeMarks, type Marks } from './marks.ts'

export const BACKUP_APP = 'nmle'
export const BACKUP_VERSION = 1

export interface Backup {
  app: typeof BACKUP_APP
  version: number
  exported_at: string
  data: Record<string, string> // localStorage 的鍵 → 原本存的字串
}

const EXCLUDED = ['nmle.device.v1', 'nmle.usage.v1']
const EXCLUDED_PREFIX = ['nmle.answers.cursor.']

export function exportable(key: string) {
  return key.startsWith('nmle.') && !EXCLUDED.includes(key) && !EXCLUDED_PREFIX.some((p) => key.startsWith(p))
}

export function buildBackup(storage: Record<string, string>, now = new Date()): Backup {
  const data = Object.fromEntries(Object.entries(storage).filter(([k]) => exportable(k)))
  return { app: BACKUP_APP, version: BACKUP_VERSION, exported_at: now.toISOString(), data }
}

/** 讀檔案內容；不是這個網站的備份檔丟出錯誤（訊息直接顯示給使用者） */
export function parseBackup(text: string): Backup {
  let b: Partial<Backup>
  try {
    b = JSON.parse(text) as Partial<Backup>
  } catch {
    throw new Error('這不是備份檔（讀不出內容）')
  }
  if (b?.app !== BACKUP_APP || typeof b.data !== 'object' || b.data === null) throw new Error('這不是這個網站的備份檔')
  if ((b.version ?? 0) > BACKUP_VERSION) throw new Error('備份檔是新版網站產生的，請重新整理網頁後再匯入')
  return b as Backup
}

const json = <T>(s: string | undefined, fallback: T): T => {
  try {
    return s === undefined ? fallback : (JSON.parse(s) as T)
  } catch {
    return fallback
  }
}

/** 一個鍵：現在存的（可能沒有）和備份裡的合併後要存什麼；不用改回傳 null */
export function mergeValue(key: string, current: string | undefined, incoming: string): string | null {
  if (current === undefined) return incoming
  if (current === incoming) return null
  if (key.startsWith('nmle.answers.v2.')) {
    const merged = mergeRecords<StoredAnswer>(decodeAnswers(current), decodeAnswers(incoming), (r) => r.answered_at)
    return merged && encodeAnswers(merged)
  }
  if (key.startsWith('nmle.mocks.v1.') || key.startsWith('nmle.gifts.v1.')) {
    type R = { id: string; synced: boolean; started_at?: string; given_at?: string }
    const time = (r: R) => r.started_at ?? r.given_at ?? ''
    const merged = mergeRecords(json<R[]>(current, []), json<R[]>(incoming, []), time)
    return merged && JSON.stringify(merged)
  }
  if (key.startsWith('nmle.marks.v1.')) {
    // 收藏、不確定、筆記：每題取改的時間比較新的（marks.ts）
    const merged = mergeMarks(json<Marks>(current, {}), json<Marks>(incoming, {}))
    return merged && JSON.stringify(merged)
  }
  if (key === 'nmle.story.seen.v1' || key === 'nmle.reports.sent.v1') {
    const a = json<string[]>(current, [])
    const union = [...new Set([...a, ...json<string[]>(incoming, [])])]
    return union.length === a.length ? null : JSON.stringify(union)
  }
  if (key === 'nmle.messages.v1') {
    type M = { key: string; read: boolean }
    const merged = mergeByKey(json<M[]>(current, []), json<M[]>(incoming, []))
    const out = JSON.stringify(merged)
    return out === current ? null : out
  }
  return null // 設定、目前這一回合等：這台裝置已經有的就不動
}

/** 整份備份要寫進哪些鍵 */
export function mergeBackup(storage: Record<string, string>, backup: Backup): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(backup.data)) {
    if (!exportable(key) || typeof value !== 'string') continue
    const merged = mergeValue(key, storage[key], value)
    if (merged !== null) out[key] = merged
  }
  return out
}

/** 備份裡有幾筆作答（匯入前給使用者確認用） */
export function countAnswers(backup: Backup) {
  return Object.entries(backup.data)
    .filter(([k]) => k.startsWith('nmle.answers.v2.'))
    .reduce((n, [, v]) => n + decodeAnswers(v).length, 0)
}

// ---------- 瀏覽器 ----------

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k !== null) out[k] = localStorage.getItem(k) ?? ''
  }
  return out
}

/** 下載備份檔 */
export function downloadBackup() {
  const backup = buildBackup(snapshot())
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nmle-backup-${backup.exported_at.slice(0, 10)}.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 匯入：合併進 localStorage，回傳寫了幾個鍵。呼叫後要重新整理網頁，記憶體裡的紀錄才會換成合併後的 */
export function importBackup(backup: Backup): number {
  const writes = mergeBackup(snapshot(), backup)
  for (const [k, v] of Object.entries(writes)) localStorage.setItem(k, v) // 空間不夠會丟出錯誤，由畫面顯示
  return Object.keys(writes).length
}
