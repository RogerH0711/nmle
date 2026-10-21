// AI 詳解的文字拆解（不依賴瀏覽器環境，方便測試）

export type Block = { kind: 'heading' | 'item' | 'para'; parts: { text: string; bold: boolean }[] }

/** 把模型輸出的簡單 Markdown（粗體標題、- 清單、段落）拆成區塊，不用 innerHTML。 */
export function parseExplanation(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^\*\*([^*]+)\*\*$/.exec(line)
    if (heading) {
      if (/^答案[:：]/.test(heading[1])) continue // 正解畫面上已經有了
      blocks.push({ kind: 'heading', parts: [{ text: heading[1], bold: false }] })
      continue
    }
    const item = /^[-*]\s+(.*)$/.exec(line)
    blocks.push({ kind: item ? 'item' : 'para', parts: inline(item ? item[1] : line) })
  }
  return blocks
}

function inline(line: string) {
  return line
    .split(/\*\*/)
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((p) => p.text)
}
