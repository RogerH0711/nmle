import { useState } from 'react'
import type { Letter } from './types'
import { NOTE_MAX, REASONS, submitReport, useReports, type ReportReason } from './reports'

// 題目下方的「回報疑義」：選原因、寫補充，送到資料庫給 Roger 處理
export function ReportButton({ questionId, picked }: { questionId: string; picked: Letter | undefined }) {
  const { reported, pending } = useReports()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>('answer')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  if (reported.has(questionId) && !open) {
    return <p className="report-done">已回報這題，謝謝！{pending > 0 && '（還沒送出，連上網路後會自動送出）'}</p>
  }
  if (!open) {
    return (
      <button className="link report-link" onClick={() => setOpen(true)}>
        回報疑義
      </button>
    )
  }

  const send = async () => {
    setSending(true)
    await submitReport(questionId, reason, note, picked ?? null) // 沒送出的會留在瀏覽器，之後自動重送
    setSending(false)
    setOpen(false)
  }

  return (
    <form
      className="report-form"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <fieldset>
        <legend>這題有什麼問題？</legend>
        {REASONS.map((r) => (
          <label key={r.id}>
            <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <textarea
        value={note}
        maxLength={NOTE_MAX}
        rows={3}
        placeholder="補充說明（選填），例如：更正答案應該是 B、第二個選項少了一個字"
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="report-hint">回報會給網站維護者檢查，不會公開。請不要寫個人資料。</p>
      <div className="report-actions">
        <button type="button" className="ghost small" onClick={() => setOpen(false)}>
          取消
        </button>
        <button type="submit" className="primary small" disabled={sending}>
          {sending ? '送出中…' : '送出回報'}
        </button>
      </div>
    </form>
  )
}
