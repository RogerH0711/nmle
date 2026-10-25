// 帳號密碼登入（不用 Email）：Supabase Auth 一定要 Email 或手機號碼，所以把帳號名稱轉成
// 「名稱@users.invalid」註冊。.invalid 是保留網域，信不會寄到任何人手上。
// 資料庫只接受這個格式的 Email 註冊（supabase/migrations/20261025120000_username_login.sql）。

export const USERNAME_DOMAIN = 'users.invalid'
export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // bcrypt 只看前 72 bytes

const USERNAME_RE = /^[a-z0-9_]+$/

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase()
}

/** 帳號名稱不合格時回傳原因；傳入前先 normalizeUsername */
export function usernameError(name: string): string | null {
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return `帳號名稱要 ${USERNAME_MIN}–${USERNAME_MAX} 個字元`
  if (!USERNAME_RE.test(name)) return '帳號名稱只能用英文字母、數字和底線'
  return null
}

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `密碼至少 ${PASSWORD_MIN} 個字元`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return '密碼太長了'
  return null
}

export function usernameEmail(name: string) {
  return `${name}@${USERNAME_DOMAIN}`
}

/** 帳號密碼註冊的帳號回傳帳號名稱；Google 帳號回傳 null */
export function usernameOf(email: string | undefined): string | null {
  const suffix = `@${USERNAME_DOMAIN}`
  return email?.endsWith(suffix) ? email.slice(0, -suffix.length) : null
}

/** Supabase Auth 的錯誤代碼轉成給使用者看的訊息 */
export function authErrorText(error: { code?: string; message: string }, mode: 'signin' | 'signup'): string {
  switch (error.code) {
    case 'invalid_credentials':
      return '帳號名稱或密碼不對'
    case 'user_already_exists':
    case 'email_exists':
      return '這個帳號名稱已經有人用了，換一個試試'
    case 'weak_password':
      return `密碼太簡單了，至少 ${PASSWORD_MIN} 個字元`
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return '嘗試太多次了，請過幾分鐘再試'
    case 'captcha_failed':
      return '真人驗證沒有通過，請等下方驗證完成後再試一次'
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'no_session': // 線上還開著「Confirm email」
      return '目前還沒開放帳號密碼註冊，請先用 Google 登入'
  }
  if (/fetch|network/i.test(error.message)) return '連不上伺服器，請確認網路連線'
  return mode === 'signup' ? '註冊失敗，請再試一次' : '登入失敗，請再試一次'
}
