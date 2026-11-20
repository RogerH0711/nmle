import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BUILD } from './bank'

// 畫面程式出錯時（render 丟出例外），React 預設會把整頁清空變成白屏。
// 這裡改成顯示說明、重新整理按鈕和錯誤訊息，讓使用者可以複製錯誤回報。作答紀錄存在瀏覽器裡，不會因此不見。
// 只接得到 render 和 effect 裡的錯誤；事件處理和 Promise 的錯誤不會到這裡（那些不會讓畫面消失）。

interface State {
  error: Error | null
  stack: string
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? '' })
    console.error(error)
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    const detail = [`版本：${BUILD}`, `網址：${location.href}`, `瀏覽器：${navigator.userAgent}`, '', String(error.stack ?? error), stack].join('\n')
    return (
      <div className="crash" role="alert">
        <h1>畫面出錯了</h1>
        <p>你的作答紀錄存在瀏覽器裡，沒有不見。先重新整理看看；一直出現的話，請把下面的錯誤訊息複製給網站維護者（GitHub Issues）。</p>
        <button className="primary" onClick={() => location.reload()}>
          重新整理
        </button>
        <textarea readOnly rows={8} value={detail} onFocus={(e) => e.currentTarget.select()} aria-label="錯誤訊息" />
      </div>
    )
  }
}
