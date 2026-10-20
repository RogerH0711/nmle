import type { AnswerRecord } from './answers'
import type { Line } from './characters'
import { localDate, reviewPasses } from './review.ts'
import { STREAK_MIN_DAILY } from './messages.ts'

// 禮物商店（docs/design.md「獎勵與商店」）：
// - 貨幣「書籤」和好感度一樣由作答紀錄推算，不另外存；只存送禮紀錄（giftStore.ts），餘額＝賺到的－花掉的。
// - 賺書籤靠答對與複習，不靠刷量：同一題答對很多次只算一次。
// - 買了直接送給一位學姊，同一位學姊一天只能送一次。
// - 送禮可以稍微推進好感度：只有「熟識」「在意」這兩階（看題數的條件），
//   每 1 點心意抵目標的 GIFT_BONUS.step，最多抵 GIFT_BONUS.cap。心動、告白前夕看正確率和模擬考，送禮不影響。

export const EARN = {
  firstCorrect: 1, // 每一題第一次答對（不同題目，所有學科）
  reviewPass: 3, // 錯題複習到期後按時答對一次
  studyDay: 5, // 一天至少寫 STREAK_MIN_DAILY 題（同排行榜的連續作答天數）
}

export const GIFT_BONUS = {
  step: 0.05, // 每 1 點心意抵目標的 5%
  cap: 0.2, // 每一階最多抵 20%
  stages: [0, 1], // 送禮時在這幾階才有加成（目標是熟識、在意）
  liked: 2, // 她喜歡的禮物算 2 點心意，其他 1 點
}

export interface Gift {
  id: string
  name: string
  icon: string
  price: number
  description: string
}

export interface GiftCatalog {
  gifts: Gift[]
  likes: Record<string, string[]> // 角色 id → 她喜歡的禮物 id
}

export interface GiftRecord {
  id: string
  character_id: string
  gift_id: string
  price: number // 送的時候的價格，之後調價不影響已經花掉的書籤
  stage: number // 送的時候她的好感度階段：加成算在這一階的下一階
  line_id: string | null // 她當時說的話（回顧用）
  given_at: string // ISO 時間
  synced: boolean
}

export interface Earnings {
  firstCorrect: number // 次數
  reviewPasses: number
  studyDays: number
  total: number // 書籤數
}

export function earnings(records: AnswerRecord[]): Earnings {
  const firstCorrect = new Set(records.filter((r) => r.correct).map((r) => r.question_id)).size
  const passes = reviewPasses(records).length
  const perDay = new Map<string, number>()
  for (const r of records) {
    const d = localDate(new Date(r.answered_at))
    perDay.set(d, (perDay.get(d) ?? 0) + 1)
  }
  const studyDays = [...perDay.values()].filter((n) => n >= STREAK_MIN_DAILY).length
  return {
    firstCorrect,
    reviewPasses: passes,
    studyDays,
    total: firstCorrect * EARN.firstCorrect + passes * EARN.reviewPass + studyDays * EARN.studyDay,
  }
}

/** 餘額。另一台裝置送的禮物先同步上來、作答紀錄還沒到時可能是負的，畫面上顯示 0 */
export function balance(records: AnswerRecord[], gifts: Pick<GiftRecord, 'price'>[]) {
  return earnings(records).total - gifts.reduce((sum, g) => sum + g.price, 0)
}

export const isLiked = (catalog: GiftCatalog, characterId: string, giftId: string) =>
  (catalog.likes[characterId] ?? []).includes(giftId)

/** 每份禮物的心意點數，給 affection() 算加成 */
export function giftPoints(catalog: GiftCatalog, gifts: Pick<GiftRecord, 'character_id' | 'gift_id' | 'stage'>[], characterId: string) {
  return gifts
    .filter((g) => g.character_id === characterId)
    .map((g) => ({ stage: g.stage, points: isLiked(catalog, characterId, g.gift_id) ? GIFT_BONUS.liked : 1 }))
}

/** 某一階的目標可以被禮物抵掉幾題（次） */
export function giftBonus(points: number, target: number) {
  return Math.min(Math.round(target * GIFT_BONUS.cap), Math.round(points * GIFT_BONUS.step * target))
}

/** 今天已經送過她了嗎（一天一次） */
export function givenToday(gifts: Pick<GiftRecord, 'character_id' | 'given_at'>[], characterId: string, today = localDate()) {
  return gifts.some((g) => g.character_id === characterId && localDate(new Date(g.given_at)) === today)
}

/** 收到禮物的台詞：她喜歡的禮物有專屬的一句（gift_liked，gift 欄位對應），其他從 gift 隨機挑 */
export function pickGiftLine(lines: Line[], giftId: string, liked: boolean, affection: number) {
  if (liked) {
    const own = lines.filter((l) => l.situation === 'gift_liked' && l.gift === giftId && l.affection_min <= affection)
    if (own.length) return own[Math.floor(Math.random() * own.length)]
  }
  const pool = lines.filter((l) => l.situation === 'gift' && l.affection_min <= affection)
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}
