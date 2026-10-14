import { createClient } from '@supabase/supabase-js'

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

export function signOut() {
  return supabase.auth.signOut()
}

export const NAME_MAX = 30

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
