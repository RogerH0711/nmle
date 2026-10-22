// 服裝：解鎖條件、買過的服裝、收到服裝的台詞、換上的服裝。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Line } from './characters.ts'
import { boughtOutfits, outfitStatus, pickOutfitLine, wornOutfit, type Outfit, type OutfitCatalog } from './outfitRules.ts'

const outfit = (o: Partial<Outfit> & { id: string }): Outfit => ({
  character: 'fei', name: o.id, description: '', folder: o.id.split('_')[1] ?? null, ...o,
})
const catalog: OutfitCatalog = {
  outfits: [
    outfit({ id: 'fei_default', folder: null }),
    outfit({ id: 'fei_casual', price: 300, stage: 1 }),
    outfit({ id: 'fei_dress', price: 600, stage: 2 }),
    outfit({ id: 'zhixun_yukata', character: 'zhixun', story: 3 }),
  ],
}
const [base, casual, dress, yukata] = catalog.outfits
const none = () => false

test('原本的衣服一開始就有', () => {
  assert.deepEqual(outfitStatus(base, { stage: 0, bought: new Set(), seenScene: none }), { kind: 'owned' })
})

test('商店的服裝：好感度到了才能買，買過就是她的', () => {
  assert.deepEqual(outfitStatus(casual, { stage: 0, bought: new Set(), seenScene: none }), { kind: 'stage', stage: 1 })
  assert.deepEqual(outfitStatus(casual, { stage: 1, bought: new Set(), seenScene: none }), { kind: 'buy', price: 300 })
  assert.deepEqual(outfitStatus(dress, { stage: 1, bought: new Set(), seenScene: none }), { kind: 'stage', stage: 2 })
  assert.deepEqual(outfitStatus(casual, { stage: 1, bought: new Set(['fei_casual']), seenScene: none }), { kind: 'owned' })
})

test('劇情服裝：看完那一階的劇情就解鎖，不能用書籤買', () => {
  assert.deepEqual(outfitStatus(yukata, { stage: 4, bought: new Set(), seenScene: none }), { kind: 'story', stage: 3 })
  const seen = (c: string, s: number) => c === 'zhixun' && s === 3
  assert.deepEqual(outfitStatus(yukata, { stage: 3, bought: new Set(), seenScene: seen }), { kind: 'owned' })
})

test('買過的服裝從送禮紀錄找，一般禮物不算', () => {
  const records = [{ gift_id: 'latte' }, { gift_id: 'fei_dress' }]
  assert.deepEqual([...boughtOutfits(catalog, records)], ['fei_dress'])
})

test('收到服裝的台詞：用 outfit 欄位對應那一套，好感度不夠的不會出現', () => {
  const line = (id: string, o: string, min = 1): Line => ({ id, situation: 'outfit', affection_min: min, expression: 'shy', outfit: o, text: id })
  const lines = [line('a', 'fei_casual'), line('b', 'fei_dress', 2), { ...line('c', 'fei_casual'), situation: 'gift' as const }]
  assert.equal(pickOutfitLine(lines, 'fei_casual', 1)?.id, 'a')
  assert.equal(pickOutfitLine(lines, 'fei_dress', 1), null)
  assert.equal(pickOutfitLine(lines, 'fei_dress', 2)?.id, 'b')
})

test('換上的服裝：沒換或清單裡已經沒有的就是原本的衣服', () => {
  assert.equal(wornOutfit(catalog, {}, 'fei'), null)
  assert.equal(wornOutfit(catalog, { fei: 'fei_dress' }, 'fei')?.id, 'fei_dress')
  assert.equal(wornOutfit(catalog, { fei: 'fei_gone' }, 'fei'), null)
  assert.equal(wornOutfit(catalog, { fei: 'fei_default' }, 'fei'), null)
})
