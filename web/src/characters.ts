// 角色資料與台詞（data/characters.json、data/lines/<id>.json，格式見 characters.md）

const BASE = import.meta.env.BASE_URL

export type Situation = 'start' | 'comeback' | 'correct' | 'wrong' | 'streak' | 'finish' | 'mock_high' | 'jealous' | 'story'

export interface Character {
  id: string
  name: string
  type: string
  color: string
  title: string
  subjects: string[]
  expressions: string[]
  enabled: boolean
}

export interface Line {
  id: string
  situation: Situation
  affection_min: number
  expression: string
  text: string
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
  const r = await fetch(`${BASE}characters.json`)
  if (!r.ok) throw new Error(`characters.json ${r.status}`)
  const data = (await r.json()) as { characters: Character[] }
  return data.characters.filter((c) => c.enabled)
}

const lineCache = new Map<string, Promise<Line[]>>()

export function loadLines(characterId: string): Promise<Line[]> {
  let p = lineCache.get(characterId)
  if (!p) {
    p = fetch(`${BASE}lines/${characterId}.json`)
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

/** 從符合情境和好感度的台詞裡隨機挑一句，盡量不和上一句重複。好感度系統還沒做，先固定 0。 */
export function pickLine(lines: Line[], situation: Situation, affection = 0, avoidId: string | null = null) {
  const pool = lines.filter((l) => l.situation === situation && l.affection_min <= affection)
  const fresh = pool.length > 1 ? pool.filter((l) => l.id !== avoidId) : pool
  return fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null
}

export function fillPlayer(text: string, player: string) {
  return text.replaceAll('{player}', player || '學弟')
}

export const portraitUrl = (characterId: string, expression: string) =>
  `${BASE}characters/${characterId}/${expression}.webp`
