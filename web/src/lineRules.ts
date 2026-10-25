import type { Line, Situation } from './characters'

// 挑台詞的規則（不碰瀏覽器 API，可以單獨測試）；寫法與理由見 characters.md「台詞寫法」。
// - 好感度：affection_min ≤ 目前階段 ≤ affection_max（沒寫就是不設上限），初識的冷淡語氣熟了以後不再出現。
// - 頻率：rare 的台詞（感情很明確的、嘲諷）抽中機率是一般的三分之一；剛升到的這一階的台詞稍微優先。
// - 知識台詞（有 keywords）只在題目或選項出現關鍵字時才能抽到，對到的話一半機會優先說它。
// - night 的台詞只在晚上抽得到：玩家不一定在晚上讀書，中午聽到「很晚了」會出戲。

export const RARE_WEIGHT = 1 / 3
export const CURRENT_STAGE_WEIGHT = 1.5
export const TOPIC_CHANCE = 0.5

/** 晚上：18 點到隔天 5 點。night 的台詞（「很晚了」「晚安」）只在這段時間出現 */
export const isNight = (hour: number) => hour >= 18 || hour < 5

/** hour 沒給（送禮、測試）就不看時段 */
export function eligible(l: Line, affection: number, hour?: number) {
  return l.affection_min <= affection && (l.affection_max === undefined || affection <= l.affection_max)
    && !(l.night && hour !== undefined && !isNight(hour))
}

/**
 * 題目文字（題幹加選項）裡有沒有這句知識台詞的關鍵字，英文不分大小寫。
 * keywords 的每一項是一個字，或一組字（陣列，要全部出現）：["凋亡", ["病毒", "核糖體"]]
 */
export function matchesTopic(l: Line, question: string) {
  const q = question.toLowerCase()
  return !!l.keywords?.some((k) => (Array.isArray(k) ? k : [k]).every((w) => q.includes(w.toLowerCase())))
}

/** 久沒上線的台詞：{days}、{hours}、{minutes} 代入離上次作答多久（hours 是總時數，minutes 是零頭） */
export function fillAway(text: string, awayMs: number) {
  const minutes = Math.floor(awayMs / 60_000)
  return text
    .replaceAll('{days}', String(Math.floor(minutes / 1440)))
    .replaceAll('{hours}', String(Math.floor(minutes / 60)))
    .replaceAll('{minutes}', String(minutes % 60))
}

export function lineWeight(l: Line, affection: number) {
  return (l.rare ? RARE_WEIGHT : 1) * (l.affection_min === affection ? CURRENT_STAGE_WEIGHT : 1)
}

function weightedPick(lines: Line[], affection: number, random: () => number) {
  const total = lines.reduce((s, l) => s + lineWeight(l, affection), 0)
  let r = random() * total
  for (const l of lines) {
    r -= lineWeight(l, affection)
    if (r < 0) return l
  }
  return lines.at(-1) ?? null
}

/**
 * 從符合情境和好感度的台詞裡挑一句，盡量不和上一句重複。
 * question 是剛作答那題的題幹加選項，只有答對、答錯、連對時才有，用來對知識台詞的關鍵字。
 * hour 是現在幾點（本地時間），night 的台詞只在晚上出現。
 */
export function pickLine(lines: Line[], situation: Situation, affection = 0, avoidId: string | null = null,
  question = '', random: () => number = Math.random, hour = new Date().getHours()) {
  const pool = lines.filter((l) => l.situation === situation && eligible(l, affection, hour))
  const fresh = (xs: Line[]) => (xs.length > 1 ? xs.filter((l) => l.id !== avoidId) : xs)
  const topical = question ? fresh(pool.filter((l) => matchesTopic(l, question))) : []
  if (topical.length && random() < TOPIC_CHANCE) return topical[Math.floor(random() * topical.length)]
  const general = fresh(pool.filter((l) => !l.keywords))
  return general.length ? weightedPick(general, affection, random) : null
}
