import { useEffect, useState } from 'react'
import type { Character } from './characters'
import { Portrait } from './CharacterStage'
import type { Message } from './messages'

// 學姊傳的訊息：聊天室樣式（見 docs/design.md「遊戲介面方向」第 4 點）

const timeLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('zh-TW', today ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 訊息下方的按鈕：直接去做訊息提到的事 */
const ACTION_LABEL: Partial<Record<Message['kind'], string>> = {
  review: '去圖書館複習',
  story: '去找她',
  comeback: '一起讀書',
}

interface Props {
  messages: Message[]
  characters: Character[]
  initial: string | null // 一打開就顯示哪位學姊的對話
  onRead: (characterId: string) => void
  onAction: (message: Message) => void
  onClose: () => void
}

export function MessageCenter({ messages, characters, initial, onRead, onAction, onClose }: Props) {
  // 有訊息的學姊，最近傳訊息的排前面
  const threads = characters
    .map((c) => ({ c, list: messages.filter((m) => m.character === c.id) }))
    .filter((t) => t.list.length)
    .sort((a, b) => b.list[b.list.length - 1].at.localeCompare(a.list[a.list.length - 1].at))
  const [open, setOpen] = useState<string | null>(initial ?? (window.matchMedia('(min-width: 600px)').matches ? threads[0]?.c.id ?? null : null))
  const thread = threads.find((t) => t.c.id === open)

  useEffect(() => {
    if (open) onRead(open)
  }, [open, messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={open ? 'messages has-thread' : 'messages'} role="dialog" aria-label="訊息" onClick={(e) => e.stopPropagation()}>
        <header className="messages-head">
          {open && (
            <button className="ghost small messages-back" onClick={() => setOpen(null)}>
              ←
            </button>
          )}
          <h2>{thread ? thread.c.name : '訊息'}</h2>
          <button className="ghost small" onClick={onClose}>
            關閉
          </button>
        </header>

        {threads.length === 0 ? (
          <p className="messages-empty">還沒有訊息。錯題到期、久沒上線、有新劇情或連續作答時，學姊會傳訊息給你。</p>
        ) : (
          <div className="messages-body">
            <ul className="threads">
              {threads.map(({ c, list }) => {
                const last = list[list.length - 1]
                const unread = list.filter((m) => !m.read).length
                return (
                  <li key={c.id}>
                    <button
                      className={c.id === open ? 'thread active' : 'thread'}
                      style={{ '--char': c.color } as React.CSSProperties}
                      onClick={() => setOpen(c.id)}
                    >
                      <span className="thread-avatar">
                        <Portrait character={c} expression="normal" />
                      </span>
                      <span className="thread-text">
                        <strong>{c.name}</strong>
                        <span>{last.text}</span>
                      </span>
                      {unread > 0 && <span className="unread">{unread}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>

            {thread && (
              <ol className="chat" style={{ '--char': thread.c.color } as React.CSSProperties}>
                {thread.list.map((m, i) => {
                  const label = ACTION_LABEL[m.kind]
                  // 每一種訊息只有最新的一則顯示按鈕（舊的到期提醒不用再按）
                  const latest = !thread.list.slice(i + 1).some((n) => n.kind === m.kind)
                  return (
                    <li key={m.key} className="bubble-row">
                      <span className="bubble-avatar">
                        <Portrait character={thread.c} expression={m.expression} />
                      </span>
                      <div>
                        <p className="bubble">{m.text}</p>
                        <span className="bubble-time">{timeLabel(m.at)}</span>
                        {latest && label && (
                          <button className="primary small bubble-action" onClick={() => onAction(m)}>
                            {label}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 收到新訊息時，畫面下方跳出的通知。點了打開那位學姊的對話 */
export function MessageToast({ message, character, onOpen, onDismiss }: {
  message: Message
  character: Character
  onOpen: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000)
    return () => clearTimeout(t)
  }, [message.key, onDismiss])

  return (
    <div className="toast" role="status" style={{ '--char': character.color } as React.CSSProperties}>
      <button className="toast-main" onClick={onOpen}>
        <span className="thread-avatar">
          <Portrait character={character} expression={message.expression} />
        </span>
        <span className="thread-text">
          <strong>{character.name} 傳來訊息</strong>
          <span>{message.text}</span>
        </span>
      </button>
      <button className="toast-close" onClick={onDismiss} aria-label="關閉通知">
        ×
      </button>
    </div>
  )
}
