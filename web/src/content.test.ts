// 台詞與劇情資料的檢查。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import type { Line } from './characters.ts'
import { eligible, matchesTopic } from './lineRules.ts'
import type { ExamFile } from './types.ts'

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

test('劇情用到的每個表情都有立繪（有寫 outfit 的劇情看那套服裝的資料夾）', () => {
  type Line = { speaker: string; expression?: string; options?: { lines: Line[] }[] }
  const flat = (lines: Line[]): Line[] => lines.flatMap((l) => [l, ...flat(l.options?.flatMap((o) => o.lines) ?? [])])
  let checked = 0
  for (const f of files.filter((f) => f.name.startsWith('stories/'))) {
    const story = JSON.parse(f.text) as { character: string; scenes: { title: string; outfit?: string; lines: Line[] }[] }
    for (const scene of story.scenes) {
      const used = new Set(['normal', ...flat(scene.lines).flatMap((l) => (l.speaker === story.character && l.expression ? [l.expression] : []))])
      for (const e of used) {
        const path = `characters/${story.character}/${scene.outfit ? `${scene.outfit}/` : ''}${e}.webp`
        assert.doesNotThrow(() => readFileSync(new URL(path, data)), `${f.name}「${scene.title}」缺 ${path}`)
      }
      checked++
    }
  }
  assert.ok(checked >= 25)
})

test('每套服裝都有那位學姊台詞用到的所有表情（換上服裝後刷題畫面也會用到）', () => {
  let checked = 0
  for (const c of readdirSync(new URL('characters/', data), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const lines = (JSON.parse(readFileSync(new URL(`lines/${c.name}.json`, data), 'utf-8')) as { lines: { expression?: string }[] }).lines
    const used = new Set(['normal', ...lines.flatMap((l) => (l.expression ? [l.expression] : []))])
    for (const outfit of readdirSync(new URL(`characters/${c.name}/`, data), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const e of used) {
        const path = `characters/${c.name}/${outfit.name}/${e}.webp`
        assert.doesNotThrow(() => readFileSync(new URL(path, data)), `缺 ${path}`)
      }
      checked++
    }
  }
  assert.ok(checked >= 2)
})

test('服裝清單：資料夾、價格、解鎖條件、收到時的台詞都對得上（outfits.ts）', () => {
  type O = { id: string; character: string; folder: string | null; price?: number; stage?: number; story?: number; bust?: { x: number; y: number; w: number } }
  const { outfits } = JSON.parse(readFileSync(new URL('outfits.json', data), 'utf-8')) as { outfits: O[] }
  const characters = (JSON.parse(readFileSync(new URL('characters.json', data), 'utf-8')) as { characters: { id: string }[] }).characters
  const giftIds = new Set((JSON.parse(readFileSync(new URL('gifts.json', data), 'utf-8')) as { gifts: { id: string }[] }).gifts.map((g) => g.id))
  assert.equal(new Set(outfits.map((o) => o.id)).size, outfits.length, '服裝 id 重複')
  for (const c of characters) {
    assert.equal(outfits.filter((o) => o.character === c.id && o.folder === null).length, 1, `${c.id} 要有一套原本的衣服`)
    const lines = (JSON.parse(readFileSync(new URL(`lines/${c.id}.json`, data), 'utf-8')) as {
      lines: { id: string; situation: string; affection_min: number; outfit?: string }[]
    }).lines
    for (const l of lines.filter((l) => l.situation === 'outfit')) {
      assert.ok(outfits.some((o) => o.id === l.outfit && o.character === c.id), `${l.id} 對應的服裝 ${l.outfit} 不在清單裡`)
    }
    for (const o of outfits.filter((o) => o.character === c.id && o.folder !== null)) {
      // 買服裝記在送禮紀錄：id 要符合 supabase gifts 表的 gift_id 格式，也不能和禮物撞名
      assert.match(o.id, /^[a-z_]{1,40}$/, `${o.id} 的格式`)
      assert.ok(!giftIds.has(o.id), `${o.id} 和禮物撞名`)
      assert.doesNotThrow(() => readdirSync(new URL(`characters/${c.id}/${o.folder}/`, data)), `${o.id} 的資料夾不存在`)
      const b = o.bust
      assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.w <= 832 && b.y + b.w / 0.73 <= 1216, `${o.id} 的胸像範圍`)
      if (o.story !== undefined) {
        assert.equal(o.price, undefined, `${o.id} 是劇情服裝，不能買`)
        const story = JSON.parse(readFileSync(new URL(`stories/${c.id}.json`, data), 'utf-8')) as { scenes: { stage: number; outfit?: string }[] }
        assert.ok(story.scenes.some((s) => s.stage === o.story && s.outfit === o.folder), `${o.id} 對應的劇情沒有穿這套`)
      } else {
        assert.ok(Number.isInteger(o.price) && o.price! > 0 && o.price! <= 1000, `${o.id} 的價格`) // gifts.price 的範圍
        assert.ok(Number.isInteger(o.stage) && o.stage! >= 1 && o.stage! <= 4, `${o.id} 的解鎖階段`)
        assert.ok(lines.some((l) => l.situation === 'outfit' && l.outfit === o.id && l.affection_min <= o.stage!), `${o.id} 沒有收到時的台詞`)
      }
    }
    // 做好的立繪資料夾都要放進清單，不然買不到
    for (const d of readdirSync(new URL(`characters/${c.id}/`, data), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      assert.ok(outfits.some((o) => o.character === c.id && o.folder === d.name), `characters/${c.id}/${d.name}/ 不在服裝清單裡`)
    }
  }
})

test('台詞的好感度欄位：每種情境在每一階都還有一般台詞可以抽（affection_max 不會把某一階抽空）', () => {
  const always = ['start', 'comeback', 'correct', 'wrong', 'streak', 'finish', 'mock_high', 'gift',
    'msg_review', 'msg_comeback', 'msg_story', 'msg_streak']
  for (const f of files.filter((f) => f.name.startsWith('lines/'))) {
    const lines = (JSON.parse(f.text) as { lines: Line[] }).lines
    for (const l of lines) {
      if (l.affection_max !== undefined) assert.ok(l.affection_max >= l.affection_min, `${l.id} 的 affection_max 比 affection_min 小`)
      if (l.keywords) assert.ok(['correct', 'wrong', 'streak'].includes(l.situation), `${l.id} 有 keywords，但 ${l.situation} 沒有題目可以對`)
      if (/\{(hours|minutes)\}/.test(l.text)) assert.equal(l.situation, 'comeback', `${l.id} 用了 {hours}／{minutes}，只有 comeback 有代入`)
    }
    for (const s of always) {
      for (let stage = 0; stage <= 5; stage++) {
        assert.ok(lines.some((l) => l.situation === s && !l.keywords && !l.night && eligible(l, stage)), `${f.name} 的 ${s} 在第 ${stage} 階沒有台詞`)
      }
    }
  }
})

test('知識台詞的關鍵字，至少對得到她負責學科的一題（不然永遠不會出現）', () => {
  const characters = (JSON.parse(readFileSync(new URL('characters.json', data), 'utf-8')) as { characters: { id: string; subjects: string[] }[] }).characters
  const questions = readdirSync(new URL('questions/', data))
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => (JSON.parse(readFileSync(new URL(`questions/${f}`, data), 'utf-8')) as ExamFile).questions)
    .filter((q) => q.valid)
  for (const c of characters) {
    const mine = questions.filter((q) => q.subject && c.subjects.includes(q.subject)).map((q) => [q.stem, ...q.options].join('\n'))
    const lines = (JSON.parse(readFileSync(new URL(`lines/${c.id}.json`, data), 'utf-8')) as { lines: Line[] }).lines
    for (const l of lines.filter((l) => l.keywords)) {
      assert.ok(l.keywords!.length > 0, `${l.id} 的 keywords 是空的`)
      assert.ok(mine.some((q) => matchesTopic(l, q)), `${l.id} 的關鍵字 ${l.keywords!.join('、')} 一題都對不到`)
    }
  }
})
