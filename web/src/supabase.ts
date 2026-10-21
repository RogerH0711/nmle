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

/**
 * 刪除帳號：資料庫刪掉帳號與所有紀錄（supabase/migrations/20261021120000_delete_account.sql），
 * 再清掉這台裝置上屬於這個帳號的紀錄（鍵名含 user id 的那些）。不可復原，呼叫前要先讓使用者確認。
 */
export async function deleteAccount(userId: string) {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw new Error(error.message)
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('nmle.') && key.includes(userId)) localStorage.removeItem(key)
    }
  } catch {
    // 讀不到瀏覽器儲存空間就算了，雲端已經刪掉
  }
  await supabase.auth.signOut({ scope: 'local' }) // 帳號已經不存在，只清這台裝置的登入狀態
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
