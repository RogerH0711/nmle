import { useState } from 'react'
import type { Character } from './characters'
import { STAGE_NAMES } from './affection'
import type { Scene } from './stories'

// 重看開場：稱呼、聲音、說明、標題畫面「看過了」的紀錄
const OPENING_KEYS = ['nmle.player.v1', 'nmle.audio.v1', 'nmle.guide.seen.v1', 'nmle.title.seen.v1']
// 全部從頭時保留的：裝置代碼（匿名使用統計用，換新的會被當成另一個人）
const KEEP_KEYS = ['nmle.device.v1']

/** 清掉本機紀錄後重新整理。只動這個網址（localhost）的 localStorage，正式網站的紀錄在另一個網址，不受影響 */
function reset(all: boolean) {
  const keys = all
    ? Object.keys(localStorage).filter((k) => k.startsWith('nmle.') && !KEEP_KEYS.includes(k))
    : OPENING_KEYS
  if (all && !confirm('清掉這個本機網址的所有作答、好感度、劇情進度？（有登入的話，雲端的紀錄會再同步回來）')) return
  keys.forEach((k) => localStorage.removeItem(k))
  location.reload()
}

/**
 * 開發者面板（11/15 Roger：本機打開只能從頭玩，看不到後面的劇情）。只在 `npm run dev` 出現：
 * App 用 import.meta.env.DEV 包起來，build 時是常數 false，這段不會進正式網站。
 * 可以直接播任何一位、任何一段劇情（不改好感度和存檔），也可以清掉本機紀錄從頭開始。
 */
export function DevPanel(props: {
  characters: Character[]
  stories: Record<string, Scene[]>
  onPlay: (character: Character, scene: Scene) => void
  freeShop: boolean
  onFreeShop: (on: boolean) => void
  onOpenShop?: () => void // 禮物清單還沒載入、或不在角色模式時沒有
}) {
  const { characters, stories, onPlay } = props
  const [open, setOpen] = useState(false)
  return (
    <div className="dev-panel">
      <button className="dev-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        🛠 開發者
      </button>
      {open && (
        <div className="dev-body">
          <h3>從頭開始</h3>
          <div className="dev-row">
            <button className="ghost small" onClick={() => reset(false)}>
              重看開場（稱呼、聲音、說明）
            </button>
            <button className="ghost small" onClick={() => reset(true)}>
              清掉所有本機紀錄
            </button>
          </div>
          <h3>商店</h3>
          <div className="dev-row">
            <label>
              <input type="checkbox" checked={props.freeShop} onChange={(e) => props.onFreeShop(e.target.checked)} /> 免費商店
            </label>
            <button
              className="ghost small"
              disabled={!props.onOpenShop}
              onClick={() => {
                setOpen(false)
                props.onOpenShop?.()
              }}
            >
              {props.onOpenShop ? '打開商店' : '打開商店（先進角色模式）'}
            </button>
          </div>
          <p>
            免費商店：不扣書籤、同一位一天可以送很多次、服裝不用等好感度或劇情。送出的東西照樣記下來（會加好感度、服裝算買過），
            要還原用上面的「清掉所有本機紀錄」。重新整理就會關掉。
          </p>
          <h3>直接看劇情</h3>
          <p>不會改好感度，也不會記成「看過」。</p>
          {characters.map((c) => (
            <div key={c.id} className="dev-row">
              <span className="dev-name" style={{ color: c.color }}>
                {c.name}
              </span>
              {(stories[c.id] ?? []).map((s) => (
                <button
                  key={s.stage}
                  className="ghost small"
                  title={s.title}
                  onClick={() => {
                    setOpen(false)
                    onPlay(c, s)
                  }}
                >
                  {STAGE_NAMES[s.stage]}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
