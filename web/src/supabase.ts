import { createClient } from '@supabase/supabase-js'
import { usernameEmail } from './login'

// publishable key 本來就是給前端用的公開金鑰；資料權限由資料庫的 Row Level Security 控管
const SUPABASE_URL = 'https://gppcwxkhkzfogdfudebu.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Bni_NigVr36ZggiBvrcpHA_nRSuneoJ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true },
})

export function signInWithGoogle() {
  // 登入完回到目前這一頁（本機開發是 localhost，上線是 GitHub Pages 的 /nmle/）
  const redirectTo = window.location.origin + window.location.pathname
  return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
}

// 帳號密碼登入：帳號名稱轉成 名稱@users.invalid（login.ts）。錯誤直接丟出，由畫面轉成中文訊息
// captchaToken 是 Cloudflare Turnstile 的驗證結果（turnstile.ts），Supabase 會向 Cloudflare 核對
export async function signInWithUsername(name: string, password: string, captchaToken: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: usernameEmail(name), password, options: { captchaToken } })
  if (error) throw error
}

export async function signUpWithUsername(name: string, password: string, captchaToken: string) {
  const { data, error } = await supabase.auth.signUp({ email: usernameEmail(name), password, options: { captchaToken } })
  if (error) throw error
  // 線上沒關掉「Confirm email」時，註冊會等一封寄不出去的確認信，不會直接登入
  if (!data.session) throw { code: 'no_session', message: 'email confirmation required' }
}

export async function getDisplayName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle()
  return (data?.display_name as string | undefined) ?? null
}

export async function setDisplayName(userId: string, name: string) {
  const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', userId)
  if (error) throw new Error(error.message)
}

// 排行榜由資料庫函式彙總（supabase/migrations/20261015000000_leaderboard.sql），只回傳暱稱與統計數字
export interface WeeklyRow {
  display_name: string
  answered: number
  correct: number
  accuracy: number
  qualified: boolean
  is_me: boolean
}

export interface StreakRow {
  display_name: string
  streak: number
  is_me: boolean
}

export const WEEKLY_MIN_ANSWERS = 50
export const STREAK_MIN_DAILY = 10

export async function fetchWeekly(): Promise<WeeklyRow[]> {
  const { data, error } = await supabase.rpc('leaderboard_weekly', { min_answers: WEEKLY_MIN_ANSWERS })
  if (error) throw new Error(error.message)
  return (data as WeeklyRow[]).map((r) => ({ ...r, accuracy: Number(r.accuracy) }))
}

export async function fetchStreaks(): Promise<StreakRow[]> {
  const { data, error } = await supabase.rpc('leaderboard_streaks', { min_daily: STREAK_MIN_DAILY })
  if (error) throw new Error(error.message)
  return data as StreakRow[]
}

export interface MockRow {
  display_name: string
  paper_id: string
  score: number
  total: number
  seconds: number
  papers: number // 考過幾份不同的考卷
  is_me: boolean
}

/** paper 為 null：每人取各考卷第一次模擬考中最好的一次 */
export async function fetchMock(paper: string | null): Promise<MockRow[]> {
  const { data, error } = await supabase.rpc('leaderboard_mock', { paper })
  if (error) throw new Error(error.message)
  return data as MockRow[]
}
