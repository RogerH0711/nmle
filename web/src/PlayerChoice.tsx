import { useEffect } from 'react'
import { PLAYER_TITLES, type PlayerTitle } from './player'

/** 選稱呼：第一次進角色模式時問一次，之後從地圖下方的「稱呼」改 */
export function PlayerChoice({
  current,
  onPick,
  onClose,
}: {
  current: PlayerTitle | null
  onPick: (t: PlayerTitle) => void
  onClose?: () => void // 第一次選的時候不能跳過
}) {
  useEffect(() => {
    if (!onClose) return
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
      <div className="modal player-choice" role="dialog" aria-label="選擇稱呼" onClick={(e) => e.stopPropagation()}>
        <h2>學姊們要怎麼叫你？</h2>
        <p>台詞和劇情裡的稱呼會跟著改，其他內容都一樣。之後可以在地圖下方的「稱呼」更改。</p>
        <div className="player-options">
          {PLAYER_TITLES.map((t) => (
            <button key={t} className={t === current ? 'primary' : 'ghost'} onClick={() => onPick(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
