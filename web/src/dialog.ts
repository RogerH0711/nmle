import { useEffect, useRef } from 'react'

// 對話框共用的鍵盤與焦點處理（商店、說明、登入、訊息、能力值、稱呼、劇情清單）：
// - 打開時把焦點移到對話框（螢幕閱讀器會念出對話框的名稱；不直接跳到輸入框，免得手機一打開就彈出鍵盤）。
// - Tab 只在對話框裡面循環，不會跑到後面被蓋住的按鈕。
// - Esc 只關最上面那個對話框。
// - 關掉後焦點回到打開它的那個按鈕。
// 沒有改用原生 <dialog>：它的 top layer 會蓋過現有的 z-index 疊放（訊息通知、劇情），要整套重排 CSS。

interface Entry {
  el: () => HTMLElement | null
  onClose: () => void
}

const stack: Entry[] = []

// iframe：登入對話框的 Turnstile 真人驗證
const FOCUSABLE = 'a[href], iframe, button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

window.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1]
  const el = top?.el()
  if (!top || !el) return
  if (e.key === 'Escape') {
    e.preventDefault()
    top.onClose()
    return
  }
  if (e.key !== 'Tab') return
  const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
  if (!items.length) {
    e.preventDefault()
    el.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const inside = el.contains(document.activeElement)
  if (e.shiftKey && (document.activeElement === first || !inside || document.activeElement === el)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault()
    first.focus()
  }
})

/**
 * 把回傳的 ref 接到對話框本體（role="dialog" 那個元素）。onClose 不給的話 Esc 不會關（例如第一次選稱呼是必選的）。
 * 對話框本體要加 tabIndex={-1} 才能接收焦點。
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const entry: Entry = { el: () => ref.current, onClose: () => closeRef.current?.() }
    stack.push(entry)
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true })
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return ref
}
