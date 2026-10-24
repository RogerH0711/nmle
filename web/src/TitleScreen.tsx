import { useEffect } from 'react'

const SEEN_KEY = 'nmle.title.seen.v1'

/** 每次打開網站先看到封面（同 galgame 的標題畫面）；同一個分頁重新整理不再出現 */
export function titleSeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    // 存不了就算了，重新整理時再顯示一次
  }
}

// 直式的螢幕（手機、平板直放）用另一張構圖（前後兩排、Logo 在上方）；styles.css 用同一個條件
const PORTRAIT_MEDIA = '(max-aspect-ratio: 1/1)'

/**
 * 開頭畫面：封面（Logo 已經在圖上）和「開始」。電腦是 data/cover.webp，「開始」在右下角的背景上；
 * 手機是 data/cover-mobile.webp，「開始」在下方的腿上。兩種都不會擋到臉。
 * 瀏覽器要使用者點過畫面才能播聲音，點「開始」剛好解鎖（audio.ts 在 pointerdown、keydown 時解鎖），進去就有 BGM。
 */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  const start = () => {
    markSeen()
    onStart()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      markSeen()
      onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])

  return (
    <div className="title-screen" onClick={start}>
      <div className="title-backdrop landscape" style={{ backgroundImage: 'url(cover.webp)' }} aria-hidden="true" />
      <div className="title-backdrop portrait" style={{ backgroundImage: 'url(cover-mobile.webp)' }} aria-hidden="true" />
      <div className="title-frame">
        <picture>
          <source media={PORTRAIT_MEDIA} srcSet="cover-mobile.webp" />
          <img className="title-cover" src="cover.webp" alt="醫師一階攻略～五位學姊陪你考過～：五位穿白袍的學姊站在櫻花樹下的醫學院前" />
        </picture>
        <button
          className="title-start"
          autoFocus
          onClick={(e) => {
            e.stopPropagation() // 外層也會 start，不要跑兩次
            start()
          }}
        >
          開始
        </button>
      </div>
    </div>
  )
}
