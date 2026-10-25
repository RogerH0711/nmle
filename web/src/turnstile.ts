// Cloudflare Turnstile：帳號密碼登入與註冊前確認是真人，擋暴力猜密碼和灌帳號。
// site key 是公開的；secret key 只填在 Supabase Dashboard（Authentication → Attack Protection）。
// 驗證結果（token）只能用一次，每次送出後要 reset。

export const TURNSTILE_SITE_KEY = '0x4AAAAAAFk_AeZVdbx97hIG'
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

/** 用到時才載入 Cloudflare 的 script（不登入的人不會載入） */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    s.onerror = () => {
      loading = null
      reject(new Error('turnstile'))
    }
    document.head.appendChild(s)
  })
  return loading
}
