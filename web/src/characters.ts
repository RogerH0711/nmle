// 角色資料與台詞（data/characters.json、data/lines/<id>.json，格式見 characters.md）
import { dataUrl } from './bank'

export type Situation =
  | 'start' | 'comeback' | 'correct' | 'wrong' | 'streak' | 'finish' | 'mock_high' | 'jealous' | 'story'
  // 學姊傳的訊息（messages.ts）
  | 'msg_review' | 'msg_comeback' | 'msg_story' | 'msg_streak'
  // 收到禮物（shop.ts）：gift 是一般禮物，gift_liked 是她喜歡的那幾樣（每樣一句，用 gift 欄位對應）
  | 'gift' | 'gift_liked'
  // 收到服裝（outfits.ts）：每套一句，用 outfit 欄位對應
  | 'outfit'

export interface Character {
  id: string
  name: string
  type: string
  color: string
  title: string
  subjects: string[]
  expressions: string[]
  bust?: { x: number; y: number; w: number } // 小框顯示的胸像範圍（立繪原圖像素）
  location?: string // 校園地圖上她所在的地點（背景 id）
  enabled: boolean
}

export const PORTRAIT_WIDTH = 832 // 立繪原圖寬度，所有角色相同

export interface Line {
  id: string
  situation: Situation
  affection_min: number
  affection_max?: number // 到這一階以後就不再出現（初識的冷淡語氣），沒寫就是不設上限
  rare?: boolean // 抽中機率是一般的三分之一：感情很明確的台詞、嘲諷
  keywords?: (string | string[])[] // 知識台詞：題目或選項出現這些字才會說；陣列是一組字，要全部出現（lineRules.ts）
  night?: boolean // 只在晚上說（「很晚了」「晚安」）
  expression: string
  text: string
  gift?: string // 只有 gift_liked：對應哪一樣禮物（data/gifts.json 的 id）
  outfit?: string // 只有 outfit：對應哪一套服裝（data/outfits.json 的 id）
}

export interface Reaction {
  character: Character
  expression: string
  text: string | null
  lineId: string | null
}

export const STREAK_EVERY = 10 // 連對幾題觸發 streak 台詞
export const COMEBACK_DAYS = 3 // 幾天沒作答算「久沒上線」

export async function loadCharacters(): Promise<Character[]> {
  const r = await fetch(dataUrl('characters.json'))
  if (!r.ok) throw new Error(`characters.json ${r.status}`)
  const data = (await r.json()) as { characters: Character[] }
  return data.characters.filter((c) => c.enabled)
}

const lineCache = new Map<string, Promise<Line[]>>()

export function loadLines(characterId: string): Promise<Line[]> {
  let p = lineCache.get(characterId)
  if (!p) {
    p = fetch(dataUrl(`lines/${characterId}.json`))
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((d: { lines: Line[] }) => d.lines)
      .catch(() => [])
    lineCache.set(characterId, p)
  }
  return p
}

export function characterForSubject(characters: Character[], subject: string | null) {
  return subject ? characters.find((c) => c.subjects.includes(subject)) : undefined
}

export { fillAway, pickLine } from './lineRules'

export function fillPlayer(text: string, player: string) {
  return text.replaceAll('{player}', player || '學弟')
}

// outfit：劇情服裝（data/characters/<角色 id>/<服裝>/），沒寫就是基本服裝
export const portraitUrl = (characterId: string, expression: string, outfit?: string) =>
  dataUrl(`characters/${characterId}/${outfit ? `${outfit}/` : ''}${expression}.webp`)
