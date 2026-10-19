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
