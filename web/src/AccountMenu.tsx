import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { dismissMerged, syncNow, type SyncStatus } from './answers'
import { deleteAccount, signOut } from './account'
import { displayNameError, NAME_MAX } from './displayName'
import { usernameOf } from './login'

// 標題列右上角：同步狀態、暱稱（可以修改）、登入／登出、刪除帳號

const STATUS_TEXT: Record<SyncStatus, string> = {
  local: '只存在這台裝置',
  syncing: '同步中…',
  synced: '已同步',
  offline: '離線，連線後自動同步',
  error: '同步失敗',
}

export function Account(props: {
  user: User | null
  displayName: string | null
  onRename: (name: string) => Promise<void>
  onLogin: () => void
  status: SyncStatus
  pending: number
  storageFull: boolean // 瀏覽器儲存空間滿了，作答紀錄存不進去
  mergedFromAnon: number // 登入時併進帳號的、這台裝置上沒登入時的作答
}) {
  const { user, displayName, onRename, onLogin, status, pending, storageFull, mergedFromAnon } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const loginName = usernameOf(user?.email) // 帳號密碼註冊的人沒有 Email 可以找回，提醒帳號名稱

  const remove = async () => {
    if (!user) return
    const typed = window.prompt(
      '刪除帳號會永久刪除雲端上的作答紀錄、模擬考、禮物、收藏與筆記和暱稱，也會清掉這台裝置上這個帳號的紀錄，無法復原。\n\n確定要刪除，請輸入「刪除」：',
    )
    if (typed?.trim() !== '刪除') return
    setSaving(true)
    try {
      await deleteAccount(user.id)
      window.alert('帳號已刪除。')
      window.location.reload() // 重新載入，清掉記憶體裡的紀錄
    } catch {
      setRenameError('刪除失敗，請確認網路連線後再試一次')
      setSaving(false)
    }
  }

  const save = async () => {
    const name = draft.trim()
    const invalid = displayNameError(name)
    if (invalid) {
      setRenameError(invalid)
      return
    }
    setSaving(true)
    try {
      await onRename(name)
      setEditing(false)
      setRenameError(null)
    } catch {
      setRenameError('儲存失敗，再試一次')
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="account">
        <span className="sync">{STATUS_TEXT.local}</span>
        {storageFull && <span className="sync error">瀏覽器空間滿了，新的作答重新整理後會不見，登入才能存到雲端</span>}
        <button className="ghost small" onClick={onLogin}>
          登入
        </button>
      </div>
    )
  }
  if (editing) {
    return (
      <form
        className="account"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          className="name-input"
          value={draft}
          maxLength={NAME_MAX}
          autoFocus
          aria-label="暱稱"
          placeholder="排行榜上顯示的名字"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="primary small" type="submit" disabled={saving}>
          儲存
        </button>
        <button className="ghost small" type="button" onClick={() => setEditing(false)}>
          取消
        </button>
        <button className="link delete-account" type="button" disabled={saving} onClick={() => void remove()}>
          刪除帳號
        </button>
        {loginName && <span className="sync">登入帳號：{loginName}</span>}
        {renameError && <span className="sync error">{renameError}</span>}
      </form>
    )
  }

  return (
    <div className="account">
      <span className={`sync ${status}`} title={pending ? `${pending} 筆尚未上傳` : undefined}>
        {STATUS_TEXT[status]}
      </span>
      {status === 'error' && (
        <button className="ghost small" onClick={() => void syncNow()}>
          重試
        </button>
      )}
      <button
        className="name link"
        title="修改暱稱（排行榜上顯示的名字）"
        onClick={() => {
          setDraft(displayName ?? '')
          setRenameError(null)
          setEditing(true)
        }}
      >
        {displayName ?? '…'} ✎
      </button>
      {storageFull && <span className="sync error">瀏覽器空間滿了，離線時的作答重新整理後會不見</span>}
      {mergedFromAnon > 0 && (
        <span className="sync">
          已把這台裝置上沒登入時寫的 {mergedFromAnon} 題併進帳號
          <button className="link dismiss" aria-label="知道了" onClick={dismissMerged}>
            ✕
          </button>
        </span>
      )}
      <button className="ghost small" onClick={() => void signOut(user.id).catch(() => window.alert('登出失敗，請再試一次'))}>
        登出
      </button>
    </div>
  )
}
