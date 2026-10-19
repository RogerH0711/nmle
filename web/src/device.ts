// 這台裝置的隨機代碼（存在瀏覽器）。回報疑義用來限制頻率，使用統計用來算有幾台裝置在用。
// 只是亂數，不含任何個人資料；清掉瀏覽器資料就會換一個。

const KEY = 'nmle.device.v1'
let cached: string | null = null

export function deviceId() {
  if (cached) return cached
  try {
    cached = localStorage.getItem(KEY)
    if (!cached) {
      cached = crypto.randomUUID()
      localStorage.setItem(KEY, cached)
    }
  } catch {
    cached ??= crypto.randomUUID() // 無痕模式等存不了的情況：這次瀏覽用同一個
  }
  return cached
}
