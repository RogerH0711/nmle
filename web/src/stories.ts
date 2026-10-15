// 好感度劇情（data/stories/<角色 id>.json，格式見 characters.md）
import { dataUrl } from './bank'

export interface StoryLine {
  speaker: string // 角色 id、player（玩家）或 narration（旁白）
  expression?: string
  text: string
}

export interface Scene {
  stage: number // 達到這個好感度階段解鎖
  title: string
  background: string // 背景 id，對應 data/backgrounds/<id>.webp；還沒有圖時用漸層色代替
  lines: StoryLine[]
}

const cache = new Map<string, Promise<Scene[]>>()

export function loadStory(characterId: string): Promise<Scene[]> {
  let p = cache.get(characterId)
  if (!p) {
    p = fetch(dataUrl(`stories/${characterId}.json`))
      .then((r) => (r.ok ? r.json() : { scenes: [] }))
      .then((d: { scenes: Scene[] }) => d.scenes)
      .catch(() => [])
    cache.set(characterId, p)
  }
  return p
}

export const backgroundUrl = (id: string) => dataUrl(`backgrounds/${id}.webp`)

// ---------- 看過的劇情 ----------
// 只存在這台裝置：換裝置會再標一次「新劇情」，不影響好感度本身（好感度由作答紀錄推算）。

const SEEN_KEY = 'nmle.story.seen.v1'

export const sceneId = (characterId: string, stage: number) => `${characterId}-${stage}`

export function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

/** 已解鎖、還沒看過的劇情裡，階段最低的那段 */
export function unseenScene(characterId: string, scenes: Scene[], stage: number, seen: Set<string>) {
  return scenes
    .filter((s) => s.stage <= stage && !seen.has(sceneId(characterId, s.stage)))
    .sort((a, b) => a.stage - b.stage)[0]
}
