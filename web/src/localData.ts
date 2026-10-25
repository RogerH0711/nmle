// 這台裝置上的紀錄（localStorage）哪些屬於帳號、刪除帳號時要清掉哪些。不依賴瀏覽器環境，方便測試。
//
// - 鍵名含 user id：作答、模擬考、送禮、服裝（answers.ts、mockStore.ts、giftStore.ts、outfits.ts）。
// - 裝置上的進度：沒有 user id，但記著這個人做過什麼。刪除帳號時一起清掉，隱私權政策寫的是「這台裝置上這個帳號的紀錄也會一起清掉」。
// - 其他是設定（角色模式、選項打亂、聲音、看過說明、裝置代碼、使用統計、還沒送出的回報），留著。

export const DEVICE_PROGRESS_KEYS = [
  'nmle.run.v2', // App.tsx：目前這一回合的題目和作答
  'nmle.mock.session.v1', // mockStore.ts：作答中的模擬考
  'nmle.story.seen.v1', // stories.ts：看過的劇情
  'nmle.messages.v1', // messages.ts：學姊傳的訊息
  'nmle.reports.sent.v1', // reports.ts：回報過哪些題目
  'nmle.player.v1', // player.ts：學姊叫你學弟還是學妹
]

/** 刪除帳號時要從 localStorage 清掉的鍵 */
export function keysToClearOnDelete(keys: string[], userId: string): string[] {
  return keys.filter((k) => k.startsWith('nmle.') && (k.includes(userId) || DEVICE_PROGRESS_KEYS.includes(k)))
}
