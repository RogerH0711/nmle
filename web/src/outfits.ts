import { useSyncExternalStore } from 'react'
import { dataUrl } from './bank'
import { wornOutfit, type OutfitCatalog } from './outfitRules'

// 服裝（docs/design.md「獎勵與商店」）：清單載入與「換上哪一套」，規則在 outfitRules.ts。
// - 清單在 data/outfits.json：每位學姊原本的衣服（folder 是 null）、商店的服裝（price、stage）、劇情服裝（story）。
// - 買商店的服裝就是送給她：存在送禮紀錄（giftStore.ts），gift_id 是服裝 id，書籤照樣扣；
//   不加好感度、不佔「一天送一次」（shop.ts 只把 gifts.json 裡的禮物算進去）。
// - 劇情服裝不用買：這台裝置看完那一階的劇情就放進她的衣櫃。
// - 換上哪一套只存在這台裝置（每個帳號分開）。劇情維持劇本寫的服裝，不受影響。

export type { Bust, Outfit, OutfitCatalog, OutfitStatus } from './outfitRules'
export { boughtOutfits, outfitsOf, outfitStatus, pickOutfitLine } from './outfitRules'

let catalog: OutfitCatalog = { outfits: [] }
let loading: Promise<OutfitCatalog> | null = null

export function loadOutfits(): Promise<OutfitCatalog> {
  loading ??= fetch(dataUrl('outfits.json'))
    .then((r) => (r.ok ? (r.json() as Promise<OutfitCatalog>) : { outfits: [] }))
    .catch(() => ({ outfits: [] }))
    .then((c) => {
      catalog = c
      emit()
      return c
    })
  return loading
}

// ---------- 換上哪一套（這台裝置，每個帳號分開） ----------

const ANON = 'anon'
const wearingKey = (owner: string) => `nmle.outfits.v1.${owner}`

function read(owner: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(wearingKey(owner))
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

let owner = ANON
let wearing = read(ANON)
let snapshot = { catalog, wearing }
const listeners = new Set<() => void>()

function emit() {
  snapshot = { catalog, wearing }
  listeners.forEach((l) => l())
}

export function useOutfits() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

function save() {
  try {
    localStorage.setItem(wearingKey(owner), JSON.stringify(wearing))
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

/** 換上一套服裝；null 是換回原本的衣服 */
export function wear(characterId: string, outfitId: string | null) {
  const next = { ...wearing }
  if (outfitId) next[characterId] = outfitId
  else delete next[characterId]
  wearing = next
  save()
  emit()
}

/** 登入狀態改變時呼叫：換成那個帳號的選擇。帳號還沒選過時，沿用登入前在這台裝置的選擇（登入前買的服裝會併進帳號，見 giftStore.ts） */
export function switchOutfitUser(userId: string | null) {
  const next = userId ?? ANON
  if (next === owner) return
  owner = next
  wearing = read(owner)
  if (owner !== ANON && !Object.keys(wearing).length) {
    const anon = read(ANON)
    if (Object.keys(anon).length) {
      wearing = anon
      save()
    }
  }
  emit()
}

/** 她現在穿的那套（原本的衣服回傳 null） */
export const worn = (characterId: string, state = snapshot) => wornOutfit(state.catalog, state.wearing, characterId)
