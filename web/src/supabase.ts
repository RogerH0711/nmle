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
