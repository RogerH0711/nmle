import { useState } from 'react'
import { setAudio, useAudio } from './audio'
import { PLAYER_TITLES, type PlayerTitle } from './player'
import { useDialog } from './dialog'

/**
 * 選稱呼：第一次進角色模式時問一次，之後從地圖下方的「稱呼」改。同一個畫面也問要不要開聲音（11/15 Roger）。
 * 第一次（不能跳過）兩個都選完按「開始」；之後從地圖打開時，點稱呼就直接關掉。
 */
export function PlayerChoice({
  current,
  onPick,
  onClose,
}: {
  current: PlayerTitle | null
  onPick: (t: PlayerTitle) => void
  onClose?: () => void // 第一次選的時候不能跳過
}) {
  const { settings } = useAudio()
  const first = !onClose
  const [picked, setPicked] = useState<PlayerTitle | null>(current)
  const dialogRef = useDialog(onClose) // Esc、Tab、焦點（dialog.ts）

  const shown = first ? picked : current
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal player-choice" role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1} aria-label="選擇稱呼" onClick={(e) => e.stopPropagation()}>
        <h2>學姊們要怎麼叫你？</h2>
        <p>台詞和劇情裡的稱呼會跟著改，其他內容都一樣。之後可以在地圖下方的「稱呼」更改。</p>
        <div className="player-options">
          {PLAYER_TITLES.map((t) => (
            <button
              key={t}
              className={t === shown ? 'primary' : 'ghost'}
              aria-pressed={t === shown}
              onClick={() => (first ? setPicked(t) : onPick(t))}
            >
              {t}
            </button>
          ))}
        </div>
        {/* 點按鈕本身就是使用者操作，瀏覽器才允許開始播放聲音 */}
        <h3>要開聲音嗎？</h3>
        <p>背景音樂、音效和學姊的配音。之後可以在標題列的喇叭按鈕調整。</p>
        <div className="player-options sound-options">
          <button className={settings.enabled ? 'primary' : 'ghost'} aria-pressed={settings.enabled} onClick={() => setAudio({ enabled: true })}>
            開啟聲音
          </button>
          <button className={settings.enabled ? 'ghost' : 'primary'} aria-pressed={!settings.enabled} onClick={() => setAudio({ enabled: false })}>
            靜音
          </button>
        </div>
        {first && (
          <button className="primary player-start" disabled={!picked} onClick={() => picked && onPick(picked)}>
            {picked ? '開始' : '先選稱呼'}
          </button>
        )}
      </div>
    </div>
  )
}
