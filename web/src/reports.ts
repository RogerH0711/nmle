import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { BUILD } from './bank'
import type { Letter } from './types'

// 回報疑義：送到 Supabase 的 reports 表，Roger 在 Dashboard 處理。沒登入也能回報。
// 先存進瀏覽器再上傳，離線或失敗會留著，連上網路後重送；已回報的題目會記住，按鈕顯示「已回報」。

export type ReportReason = 'answer' | 'typo' | 'image' | 'subject' | 'other'

export const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'answer', label: '答案有誤' },
  { id: 'typo', label: '題目或選項有錯字、缺字' },
  { id: 'image', label: '圖片有問題' },
  { id: 'subject', label: '學科分類錯誤' },
  { id: 'other', label: '其他' },
]

export const NOTE_MAX = 500

interface PendingReport {
  id: string
  device_id: string
  question_id: string
  reason: ReportReason
  note: string | null
  picked: Letter | null
  build: string
}

const PENDING_KEY = 'nmle.reports.pending.v1'
const SENT_KEY = 'nmle.reports.sent.v1' // 回報過的題目 id
const DEVICE_KEY = 'nmle.device.v1'

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
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

/** 這台裝置的亂數 id，資料庫用來限制回報頻率 */
function deviceId() {
  let id = read<string | null>(DEVICE_KEY, null)
  if (!id) {
    id = crypto.randomUUID()
    write(DEVICE_KEY, id)
  }
  return id
}

let pending = read<PendingReport[]>(PENDING_KEY, [])
let reported = new Set(read<string[]>(SENT_KEY, []))
const listeners = new Set<() => void>()

function changed() {
  write(PENDING_KEY, pending)
  write(SENT_KEY, [...reported])
  snapshot = { reported, pending: pending.length }
  listeners.forEach((l) => l())
}

let snapshot = { reported, pending: pending.length }

export function useReports() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

/** 送出回報。回傳 true 代表已經上傳；false 代表先存著，之後會自動重送。 */
export async function submitReport(questionId: string, reason: ReportReason, note: string, picked: Letter | null) {
  pending = [
    ...pending,
    {
      id: crypto.randomUUID(),
      device_id: deviceId(),
      question_id: questionId,
      reason,
      note: note.trim().slice(0, NOTE_MAX) || null,
      picked,
      build: BUILD,
    },
  ]
  reported = new Set([...reported, questionId])
  changed()
  return flushReports()
}

let flushing: Promise<boolean> | null = null

/** 把還沒上傳的回報送出去；全部送出回傳 true */
export function flushReports(): Promise<boolean> {
  flushing ??= (async () => {
    try {
      while (pending.length) {
        if (!navigator.onLine) return false
        const r = pending[0]
        const { error } = await supabase.from('reports').insert(r)
        // 23xxx：同一個 id 已經送過（重送），或資料不合法；42501：權限不符。這些重送也沒用，從佇列拿掉，
        // 免得卡住後面的回報。回報太頻繁（觸發器擋下）或網路錯誤就留著，之後再送
        if (error && !error.code?.startsWith('23') && error.code !== '42501') return false
        pending = pending.slice(1)
        changed()
      }
      return true
    } finally {
      flushing = null
    }
  })()
  return flushing
}

window.addEventListener('online', () => void flushReports())
if (pending.length) void flushReports()
