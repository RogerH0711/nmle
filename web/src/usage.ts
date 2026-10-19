import { supabase } from './supabase'
import { BUILD } from './bank'
import { deviceId } from './device'
import { localDate } from './review'

// 匿名使用統計：每台裝置每天一筆「今天在這台裝置作答幾題」，送到 Supabase 的 usage_daily（見 migration 20261020000000）。
// 只送隨機的裝置代碼、題數、有沒有開角色模式、有沒有登入、網站版本；不送 user id 或作答內容。
// 題數只算在這台裝置作答的（登入後從別的裝置同步下來的不算），才不會重複計算。
// 送不出去（離線、資料庫還沒更新）就算了，下次打開網站或作答時會再送一次最新的數字。

const KEY = 'nmle.usage.v1'
const DELAY_MS = 15_000 // 作答後等一下再送，連續作答時不要每題都送

interface Today {
  day: string
  answered: number
}

let today: Today = load()
let context = { characterMode: false, signedIn: false }
let timer: ReturnType<typeof setTimeout> | undefined

function load(): Today {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Today | null
    if (t && t.day === localDate()) return t
  } catch {
    // 讀不到就從 0 開始
  }
  return { day: localDate(), answered: 0 }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(today))
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

function rollOver() {
  if (today.day !== localDate()) today = { day: localDate(), answered: 0 }
}

async function send() {
  clearTimeout(timer)
  timer = undefined
  if (!navigator.onLine) return
  rollOver()
  try {
    await supabase.rpc('ping_usage', {
      device: deviceId(),
      answered: Math.min(today.answered, 5000),
      character_mode: context.characterMode,
      signed_in: context.signedIn,
      build: BUILD,
    })
  } catch {
    // 統計送不出去不影響使用
  }
}

/** 這台裝置剛作答了 n 題 */
export function countAnswers(n: number) {
  rollOver()
  today = { ...today, answered: today.answered + n }
  save()
  clearTimeout(timer)
  timer = setTimeout(() => void send(), DELAY_MS)
}

/** 打開網站、切換角色模式或登入狀態時呼叫：更新狀態並送一次（也記錄「有打開但沒作答」） */
export function reportUsage(next: { characterMode: boolean; signedIn: boolean }) {
  context = next
  void send()
}

// 關掉或切走分頁時，把還沒送的那次送出去
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && timer) void send()
})
