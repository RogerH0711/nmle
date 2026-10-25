// 登出與刪除帳號：除了 Supabase 的登入狀態，也處理這台裝置上的紀錄。
// 先把各個紀錄的擁有者換成 anon（同步中的請求回來後看到擁有者換了就不會再寫入），再整理 localStorage，
// 否則清掉之後可能又被同步寫回去。
import { keepUnsyncedAnswers, switchUser } from './answers'
import { keepUnsyncedGifts, switchGiftUser } from './giftStore'
import { keysToClearOnDelete } from './localData'
import { keepUnsyncedMocks, switchMockUser } from './mockStore'
import { switchOutfitUser } from './outfits'
import { supabase } from './supabase'

function switchToAnon() {
  // 這幾個函式切換擁有者的部分是同步執行的，不用等
  void switchUser(null)
  void switchMockUser(null)
  void switchGiftUser(null)
  switchOutfitUser(null)
}

/**
 * 登出：這個帳號在這台裝置上只留還沒同步的紀錄（共用電腦的下一個人看不到），下次登入再從雲端拉下來。
 * 離線時登不出伺服器，至少登出這台裝置。
 */
export async function signOut(userId: string) {
  const { error } = await supabase.auth.signOut()
  if (error) {
    const local = await supabase.auth.signOut({ scope: 'local' })
    if (local.error) throw new Error(local.error.message)
  }
  switchToAnon()
  keepUnsyncedAnswers(userId)
  keepUnsyncedMocks(userId)
  keepUnsyncedGifts(userId)
}

/**
 * 刪除帳號：資料庫刪掉帳號與所有紀錄（supabase/migrations/20261021120000_delete_account.sql），
 * 再清掉這台裝置上這個帳號的紀錄和作答進度（localData.ts）。不可復原，呼叫前要先讓使用者確認。
 */
export async function deleteAccount(userId: string) {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw new Error(error.message)
  await supabase.auth.signOut({ scope: 'local' }) // 帳號已經不存在，只清這台裝置的登入狀態
  switchToAnon()
  try {
    for (const key of keysToClearOnDelete(Object.keys(localStorage), userId)) localStorage.removeItem(key)
  } catch {
    // 讀不到瀏覽器儲存空間就算了，雲端已經刪掉
  }
}
