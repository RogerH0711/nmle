// AI 詳解的文字拆解與分級說明（不依賴瀏覽器環境，方便測試；SEO 靜態頁 scripts/static-pages.ts 也用）

export type ExplanationLevel = 'checked' | 'terms' | 'conflict' | 'unchecked'

export const LEVELS: Record<ExplanationLevel, { label: string; note: string }> = {
  checked: { label: '已比對', note: '和參考詳解的結論一致，名詞也檢查過。仍可能有參考詳解沒涵蓋的錯誤。' },
  terms: { label: '名詞可能有誤', note: '結論和參考詳解一致，但有名詞的中文譯名可能不對，見下方。' },
  conflict: { label: '和參考詳解不同', note: '這篇詳解有部分結論和參考詳解衝突，可能有錯，請以課本為準。' },
  unchecked: { label: '未經比對', note: '這題沒有參考詳解可以比對，正確性沒有檢查過。' },
}

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
