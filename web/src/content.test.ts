// 台詞與劇情資料的檢查。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const data = new URL('../../data/', import.meta.url)
const files = ['lines', 'stories'].flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, data))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: `${dir}/${f}`, text: readFileSync(new URL(`${dir}/${f}`, data), 'utf-8') })),
)

test('台詞和劇情都是合法的 JSON', () => {
  assert.ok(files.length >= 10)
  for (const f of files) assert.doesNotThrow(() => JSON.parse(f.text), f.name)
})

test('玩家的稱呼一律寫 {player}，不能寫死學弟或學妹（玩家可以選）', () => {
  for (const f of files) {
    const hits = f.text.split('\n').filter((l) => /學弟|學妹/.test(l))
    assert.deepEqual(hits, [], `${f.name} 有寫死的稱呼`)
  }
})

test('每位學姊都有四種訊息的台詞（學姊傳訊息用，見 messages.ts）', () => {
  const kinds = ['msg_review', 'msg_comeback', 'msg_story', 'msg_streak']
  for (const f of files.filter((f) => f.name.startsWith('lines/'))) {
    const situations = new Set((JSON.parse(f.text) as { lines: { situation: string }[] }).lines.map((l) => l.situation))
    for (const k of kinds) assert.ok(situations.has(k), `${f.name} 沒有 ${k}`)
  }
})

test('禮物：每位學姊都有收禮台詞，她喜歡的每一樣禮物都有專屬的一句（shop.ts）', () => {
  const catalog = JSON.parse(readFileSync(new URL('gifts.json', data), 'utf-8')) as {
    gifts: { id: string; name: string; price: number }[]
    likes: Record<string, string[]>
  }
  assert.ok(!/學弟|學妹/.test(JSON.stringify(catalog)), 'gifts.json 有寫死的稱呼')
  const ids = new Set(catalog.gifts.map((g) => g.id))
  assert.equal(ids.size, catalog.gifts.length, '禮物 id 重複')
  for (const g of catalog.gifts) assert.ok(g.price > 0 && g.price <= 1000, `${g.id} 的價格`) // 資料庫 gifts.price 的範圍
  const characters = (JSON.parse(readFileSync(new URL('characters.json', data), 'utf-8')) as { characters: { id: string }[] }).characters
  for (const c of characters) {
    const lines = (JSON.parse(readFileSync(new URL(`lines/${c.id}.json`, data), 'utf-8')) as {
      lines: { situation: string; affection_min: number; gift?: string }[]
    }).lines
    assert.ok(lines.some((l) => l.situation === 'gift' && l.affection_min === 0), `${c.id} 沒有初識就能用的 gift 台詞`)
    const likes = catalog.likes[c.id] ?? []
    assert.ok(likes.length > 0, `${c.id} 沒有喜歡的禮物`)
    for (const g of likes) {
      assert.ok(ids.has(g), `${c.id} 喜歡的 ${g} 不在禮物清單裡`)
      assert.ok(lines.some((l) => l.situation === 'gift_liked' && l.gift === g && l.affection_min === 0), `${c.id} 沒有 ${g} 的專屬台詞`)
    }
    for (const l of lines.filter((l) => l.situation === 'gift_liked')) assert.ok(likes.includes(l.gift ?? ''), `${c.id} 的 gift_liked 對應到她不喜歡的 ${l.gift}`)
  }
})

test('劇情服裝：有寫 outfit 的劇情，用到的每個表情都有那套服裝的立繪', () => {
  type Line = { speaker: string; expression?: string; options?: { lines: Line[] }[] }
  const flat = (lines: Line[]): Line[] => lines.flatMap((l) => [l, ...flat(l.options?.flatMap((o) => o.lines) ?? [])])
  let checked = 0
  for (const f of files.filter((f) => f.name.startsWith('stories/'))) {
    const story = JSON.parse(f.text) as { character: string; scenes: { title: string; outfit?: string; lines: Line[] }[] }
    for (const scene of story.scenes.filter((s) => s.outfit)) {
      const used = new Set(['normal', ...flat(scene.lines).flatMap((l) => (l.speaker === story.character && l.expression ? [l.expression] : []))])
      for (const e of used) {
        const path = `characters/${story.character}/${scene.outfit}/${e}.webp`
        assert.doesNotThrow(() => readFileSync(new URL(path, data)), `${f.name}「${scene.title}」缺 ${path}`)
      }
      checked++
    }
  }
  assert.ok(checked >= 2)
})
