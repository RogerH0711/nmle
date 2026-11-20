import { useEffect, useRef } from 'react'

// 手機的返回鍵：網站是單頁應用，原本沒有任何 history 紀錄，看劇情、開商店時按返回會直接離開網站。
// 每打開一層（對話框、劇情、排行榜等畫面）就推一筆 history；按返回時關掉最上面那層。
// 用介面關掉時（按「關閉」、Esc），把那一筆退掉，之後按返回才不會多退一層。
// history 的每一筆內容都一樣，只要筆數和打開的層數對得上就好，所以不用管是哪一層的。

// close 回傳 false：這一層不能用返回鍵離開（模擬考作答中），再推一筆回去
type Close = () => boolean | void

interface Entry {
  close: Close
}

const stack: Entry[] = []
let skip = 0 // 自己呼叫 history.back() 造成的 popstate，不是使用者按返回，要略過

window.addEventListener('popstate', () => {
  if (skip > 0) {
    skip--
    return
  }
  const top = stack.pop()
  if (top && top.close() === false) {
    stack.push(top)
    history.pushState(history.state, '')
  }
})

/** 打開一層，回傳「用介面關掉時」要呼叫的函式 */
function push(close: Close): () => void {
  const entry = { close }
  stack.push(entry)
  history.pushState(history.state, '')
  return () => {
    const i = stack.indexOf(entry)
    if (i < 0) return // 已經被返回鍵關掉了
    stack.splice(i, 1)
    skip++
    history.back()
  }
}

/** open 為 true 時佔一筆 history，使用者按返回就呼叫 onBack（通常就是關掉這一層；回傳 false 就留在這一層） */
export function useBack(open: boolean, onBack: Close) {
  const ref = useRef(onBack)
  ref.current = onBack
  useEffect(() => {
    if (!open) return
    return push(() => ref.current())
  }, [open])
}
