// 暱稱（排行榜上顯示的名字）的規則，和資料庫的 profiles_display_name_visible 一致
// （supabase/migrations/20261025220000_display_name_rules.sql）。不依賴瀏覽器環境，方便測試。

export const NAME_MAX = 30

// 控制字元、零寬字元、方向控制字元（會讓文字反向顯示）、看起來是空白的填充字元
const INVISIBLE = /[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/

/** 暱稱不合格時回傳原因；傳入前先 trim() */
export function displayNameError(name: string): string | null {
  const length = [...name].length // 和資料庫的 char_length 一樣算字數（emoji 算一個字）
  if (length < 1 || length > NAME_MAX) return `暱稱要 1\u2013${NAME_MAX} 個字`
  if (INVISIBLE.test(name)) return '暱稱不能有看不見的字元或控制字元'
  return null
}
