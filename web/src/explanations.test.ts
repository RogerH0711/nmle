// AI 詳解的 Markdown 拆解。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseExplanation } from './explanationText.ts'

test('粗體標題、清單、段落分開；答案那行略過', () => {
  const blocks = parseExplanation('**答案：D**\n\n**關鍵觀念**\n鼻腔有**雙重**血液供應。\n\n**選項解析**\n- (A) 錯誤。\n- (D) 正確。')
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['heading', 'para', 'heading', 'item', 'item'],
  )
  assert.equal(blocks[0].parts[0].text, '關鍵觀念')
  assert.deepEqual(blocks[1].parts, [
    { text: '鼻腔有', bold: false },
    { text: '雙重', bold: true },
    { text: '血液供應。', bold: false },
  ])
  assert.equal(blocks[3].parts[0].text, '(A) 錯誤。')
})

test('不會產生 HTML：角括號照原樣保留成文字', () => {
  const [b] = parseExplanation('<img src=x onerror=alert(1)>')
  assert.equal(b.parts[0].text, '<img src=x onerror=alert(1)>')
})
