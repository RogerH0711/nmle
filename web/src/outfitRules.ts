import type { Line } from './characters'
import type { GiftRecord } from './shop'

// 服裝的規則（不碰瀏覽器 API，可以單獨測試）；清單載入與「換上哪一套」在 outfits.ts。
// 設計見 docs/design.md「獎勵與商店」。

export interface Bust {
  x: number
  y: number
  w: number
}

export interface Outfit {
  id: string
  character: string
  name: string
  description: string
  folder: string | null // data/characters/<角色 id>/<folder>/；null 是原本的衣服
  price?: number // 商店的服裝（書籤）
  stage?: number // 好感度到這一階才能買
  story?: number // 劇情服裝：看完這一階的劇情後解鎖
  bust?: Bust // 這套立繪在小框顯示的胸像範圍
}

export interface OutfitCatalog {
  outfits: Outfit[]
}

export type OutfitStatus =
  | { kind: 'owned' } // 原本的衣服、買過的、看完劇情解鎖的
  | { kind: 'buy'; price: number } // 可以買（書籤夠不夠由畫面判斷）
  | { kind: 'stage'; stage: number } // 好感度還不夠
  | { kind: 'story'; stage: number } // 劇情服裝，還沒看那段劇情

export const outfitsOf = (catalog: OutfitCatalog, characterId: string) =>
  catalog.outfits.filter((o) => o.character === characterId)

/** 送禮紀錄裡買過的服裝 id */
export function boughtOutfits(catalog: OutfitCatalog, records: Pick<GiftRecord, 'gift_id'>[]) {
  const ids = new Set(catalog.outfits.map((o) => o.id))
  return new Set(records.filter((r) => ids.has(r.gift_id)).map((r) => r.gift_id))
}

/**
 * 這套服裝現在的狀態。stage 是她目前的好感度階段；seenScene 回答「這台裝置看過她那一階的劇情嗎」
 * （stories.ts 的 sceneId，由呼叫的地方查，這裡才不用載入劇情模組）
 */
export function outfitStatus(
  o: Outfit,
  ctx: { stage: number; bought: Set<string>; seenScene: (characterId: string, stage: number) => boolean },
): OutfitStatus {
  if (o.folder === null || ctx.bought.has(o.id)) return { kind: 'owned' }
  if (o.story !== undefined) return ctx.seenScene(o.character, o.story) ? { kind: 'owned' } : { kind: 'story', stage: o.story }
  if (o.stage !== undefined && ctx.stage < o.stage) return { kind: 'stage', stage: o.stage }
  return { kind: 'buy', price: o.price ?? 0 }
}

/** 買服裝時她說的話：outfit 欄位對應這套服裝 */
export function pickOutfitLine(lines: Line[], outfitId: string, affection: number) {
  const pool = lines.filter((l) => l.situation === 'outfit' && l.outfit === outfitId && l.affection_min <= affection)
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}

/** 她現在穿的那套（原本的衣服回傳 null）。清單裡已經沒有的就當作原本的衣服 */
export function wornOutfit(catalog: OutfitCatalog, wearing: Record<string, string>, characterId: string): Outfit | null {
  const id = wearing[characterId]
  return (id && catalog.outfits.find((o) => o.id === id && o.folder !== null)) || null
}
