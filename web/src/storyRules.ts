// 劇情資料的純函式（不依賴瀏覽器與 Vite，Node 的測試可以直接載入；stories.ts 會讀 import.meta.env）
import type { StoryLine } from './stories'

/** 這段劇情裡她用到的表情（含選項後的台詞；沒寫表情的台詞是 normal）：預載立繪、檢查立繪齊不齊都用這個 */
export function sceneExpressions(lines: StoryLine[], characterId: string): string[] {
  const out = new Set(['normal'])
  const walk = (ls: StoryLine[]) => {
    for (const l of ls) {
      if (l.speaker === characterId && l.expression) out.add(l.expression)
      for (const o of l.options ?? []) walk(o.lines)
    }
  }
  walk(lines)
  return [...out]
}
