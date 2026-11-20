import { useId, useState, useSyncExternalStore } from 'react'
import { useBack } from './backStack'
import { useDialog } from './dialog'

// 確認與通知的對話框，取代 window.confirm／alert／prompt（11/20，改進清單第 14 項）：
// Dcard、LINE 這類 App 內建的瀏覽器可能直接擋掉原生對話框，刪除帳號要輸入「刪除」的 prompt 會變成永遠刪不掉。
// 用法跟 window.confirm 一樣是等結果：if (!(await ask({ title, message }))) return
// 畫面上只有一個（<ConfirmHost /> 掛在 main.tsx），同時只處理一個請求；新的進來時，舊的當作取消。
// Esc、點外面、手機返回鍵都等於取消。

export interface AskOptions {
  title: string
  message: string
  confirm?: string // 確定按鈕的文字，預設「確定」
  cancel?: string | null // 取消按鈕的文字，預設「取消」；null 是只有一個按鈕的通知
  danger?: boolean // 刪除這類無法復原的動作：紅色按鈕
  requireText?: string // 要先輸入這段文字才能按確定（刪除帳號輸入「刪除」）
}

interface Request extends AskOptions {
  id: number
  resolve: (ok: boolean) => void
}

let current: Request | null = null
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** 打開確認對話框，按確定是 true，其他方式關掉都是 false */
export function ask(options: AskOptions): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => {
    current = { ...options, id: nextId++, resolve }
    emit()
  })
}

/** 只有「知道了」一個按鈕的通知，關掉之後才繼續 */
export function tell(title: string, message: string): Promise<void> {
  return ask({ title, message, confirm: '知道了', cancel: null }).then(() => undefined)
}

/** 關掉還開著的對話框（當作取消）：例如模擬考時間到自動交卷，「確定要交卷嗎」就不該留在成績畫面上 */
export function dismiss() {
  if (current) settle(current.id, false)
}

function settle(id: number, ok: boolean) {
  if (current?.id !== id) return
  const req = current
  current = null
  emit()
  req.resolve(ok)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current)
  return req ? <ConfirmDialog key={req.id} req={req} /> : null
}

function ConfirmDialog({ req }: { req: Request }) {
  const [typed, setTyped] = useState('')
  const id = useId()
  const cancel = () => settle(req.id, false)
  const dialogRef = useDialog<HTMLFormElement>(cancel) // Esc、Tab、焦點（dialog.ts）
  useBack(true, cancel) // 手機返回鍵（backStack.ts）
  const ready = !req.requireText || typed.trim() === req.requireText
  return (
    <div className="modal-backdrop confirm-backdrop" onClick={cancel}>
      <form
        className={req.danger ? 'modal confirm danger' : 'modal confirm'}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault() // 輸入框裡按 Enter 也走這裡
          if (ready) settle(req.id, true)
        }}
      >
        <h2 id={`${id}-title`}>{req.title}</h2>
        <p className="confirm-message" id={`${id}-message`}>
          {req.message}
        </p>
        {req.requireText && (
          <label className="confirm-input">
            確定的話，請輸入「{req.requireText}」
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          </label>
        )}
        <div className="confirm-actions">
          {req.cancel !== null && (
            <button type="button" className="ghost" onClick={cancel}>
              {req.cancel ?? '取消'}
            </button>
          )}
          <button type="submit" className={req.danger ? 'danger' : 'primary'} disabled={!ready}>
            {req.confirm ?? '確定'}
          </button>
        </div>
      </form>
    </div>
  )
}
