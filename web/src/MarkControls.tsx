import { useEffect, useRef, useState } from 'react'
import { markOf, NOTE_MAX } from './marks'
import { updateMark, useMarks } from './marksStore'

// 題目上的收藏、不確定、筆記（規則在 marks.ts，儲存與同步在 marksStore.ts）。題目卡和題庫都用。

/** 題目右上角的星號：收藏這題 */
export function FavoriteButton({ questionId }: { questionId: string }) {
  const { favorite } = markOf(useMarks().marks, questionId)
  return (
    <button
      className={favorite ? 'mark-star on' : 'mark-star'}
      aria-pressed={favorite}
      aria-label={favorite ? '取消收藏' : '收藏這題'}
      title={favorite ? '已收藏（圖書館的「收藏」清單）' : '收藏這題，之後可以在圖書館一起刷'}
      onClick={() => updateMark(questionId, { favorite: !favorite })}
    >
      {favorite ? '★' : '☆'}
    </button>
  )
}

/** 答對之後：沒把握就加進圖書館的「不確定」清單 */
export function UnsureToggle({ questionId }: { questionId: string }) {
  const { unsure } = markOf(useMarks().marks, questionId)
  return (
    <button
      className={unsure ? 'ghost small mark-unsure on' : 'ghost small mark-unsure'}
      aria-pressed={unsure}
      onClick={() => updateMark(questionId, { unsure: !unsure })}
    >
      {unsure ? '✓ 已加入不確定清單' : '其實是猜的？加入不確定清單'}
    </button>
  )
}

/**
 * 筆記：沒有筆記時只顯示「寫筆記」，有的話直接顯示內容。離開輸入框、換題時存起來。
 * 只存在自己的紀錄裡（登入後同步），別人看不到。
 */
export function NoteEditor({ questionId }: { questionId: string }) {
  const { note } = markOf(useMarks().marks, questionId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? '')
  const draftRef = useRef<string | null>(null) // 還沒存的內容；換題（卸載）時存
  draftRef.current = editing ? draft : null

  useEffect(
    () => () => {
      if (draftRef.current !== null) updateMark(questionId, { note: draftRef.current })
    },
    [questionId],
  )

  const save = () => {
    updateMark(questionId, { note: draft })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="mark-note editing">
        <textarea
          value={draft}
          maxLength={NOTE_MAX}
          rows={3}
          autoFocus
          aria-label="這題的筆記"
          placeholder="只有你看得到。例如：這題的陷阱、要背的重點"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation() // 不要關掉外面的對話框
              setDraft(note ?? '')
              setEditing(false)
            }
          }}
        />
      </div>
    )
  }
  return (
    <div className="mark-note">
      {note && <p className="mark-note-text">{note}</p>}
      <button
        className="link"
        onClick={() => {
          setDraft(note ?? '')
          setEditing(true)
        }}
      >
        {note ? '編輯筆記' : '寫筆記'}
      </button>
    </div>
  )
}
