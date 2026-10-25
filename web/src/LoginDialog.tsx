import { useEffect, useRef, useState } from 'react'
import { loadTurnstile, TURNSTILE_SITE_KEY } from './turnstile'
import {
  authErrorText, normalizeUsername, PASSWORD_MAX, passwordError, USERNAME_MAX, usernameError,
} from './login'
import { signInWithGoogle, signInWithUsername, signUpWithUsername } from './supabase'

type Mode = 'signin' | 'signup'

/** 登入：Google，或不用 Email 的帳號密碼（10/25 朋友擔心 Google 登入的個資，先講清楚網站拿到什麼，再給另一個選擇） */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 帳號密碼登入前的真人驗證（turnstile.ts）
  const captchaRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaFailed, setCaptchaFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then((t) => {
        if (cancelled || !captchaRef.current) return
        widgetId.current = t.render(captchaRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'zh-tw',
          callback: (token: string) => setCaptcha(token),
          'expired-callback': () => setCaptcha(null),
          'error-callback': () => setCaptcha(null),
        })
      })
      .catch(() => setCaptchaFailed(true))
    return () => {
      cancelled = true
      if (widgetId.current) window.turnstile?.remove(widgetId.current)
    }
  }, [])

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    setConfirm('')
  }

  const submit = async () => {
    const name = normalizeUsername(username)
    const invalid = usernameError(name) ?? (mode === 'signup' ? passwordError(password) : null)
    if (invalid) return setError(invalid)
    if (!password) return setError('請輸入密碼')
    if (mode === 'signup' && password !== confirm) return setError('兩次輸入的密碼不一樣')
    if (!captcha) return setError(captchaFailed ? '真人驗證載入失敗，請確認網路連線後重新整理' : '請等下方的真人驗證完成')
    setBusy(true)
    setError(null)
    try {
      await (mode === 'signup' ? signUpWithUsername(name, password, captcha) : signInWithUsername(name, password, captcha))
      onClose() // 登入後的同步由 App 的 onAuthStateChange 處理
    } catch (e) {
      setError(authErrorText(e as { code?: string; message: string }, mode))
      setBusy(false)
      // token 只能用一次，失敗後重新驗證
      setCaptcha(null)
      if (widgetId.current) window.turnstile?.reset(widgetId.current)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal login" role="dialog" aria-label="登入" onClick={(e) => e.stopPropagation()}>
        <h2>登入</h2>
        <p className="login-why">
          不登入也能刷題，紀錄存在這台裝置的瀏覽器裡。登入後紀錄會同步到各裝置，也能上排行榜；登入前在這台裝置寫的題目會併進帳號。
        </p>

        <button className="primary small login-google" disabled={busy} onClick={() => void signInWithGoogle()}>
          用 Google 登入
        </button>
        <p className="login-note">
          網站只會收到你的 Email、Google 名稱和大頭貼網址，用來認出你的帳號，不會顯示給其他人。看不到你的信件，也拿不到 Google 密碼。
        </p>

        <h3 className="login-divider">不想用 Google？用帳號密碼（不用 Email）</h3>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'tab active' : 'tab'} onClick={() => switchMode('signin')}>
            登入
          </button>
          <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'tab active' : 'tab'} onClick={() => switchMode('signup')}>
            註冊新帳號
          </button>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label>
            帳號名稱
            <input
              value={username}
              maxLength={USERNAME_MAX}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={mode === 'signup' ? '英文字母、數字、底線，3–20 個字元' : undefined}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              value={password}
              maxLength={PASSWORD_MAX}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? '至少 8 個字元' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === 'signup' && (
            <>
              <label>
                再輸入一次密碼
                <input
                  type="password"
                  value={confirm}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <ul className="login-note">
                <li>帳號名稱只用來登入，排行榜上顯示的是暱稱。</li>
                <li>
                  <strong>沒有 Email，忘記密碼就找不回帳號</strong>，請記好帳號名稱和密碼。
                </li>
                <li>不要用其他網站用過的密碼。</li>
              </ul>
            </>
          )}
          <div ref={captchaRef} className="login-captcha" />
          {error && <p className="login-error">{error}</p>}
          <div className="login-actions">
            <button type="button" className="ghost small" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary small" disabled={busy}>
              {mode === 'signup' ? '註冊並登入' : '登入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
