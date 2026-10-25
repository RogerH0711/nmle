import { dataUrl, paperOf } from './bank'

// AI 生成的詳解：pipeline/explain/export_web.py 匯出到 data/explanations/<考卷>.json。
// 分級說明見 docs/design.md「詳解與題目正確率」。

export type ExplanationLevel = 'checked' | 'terms' | 'conflict' | 'unchecked'

export interface Explanation {
  text: string
  level: ExplanationLevel
  terms?: { en: string; correct: string }[]
}

interface ExplanationFile {
  model: string
  questions: Record<string, Explanation>
}

const files = new Map<string, Promise<ExplanationFile | null>>()

/** 載入一份考卷的詳解；這份考卷還沒有詳解時回傳 null */
function loadFile(paperId: string): Promise<ExplanationFile | null> {
  let p = files.get(paperId)
  if (!p) {
    p = fetch(dataUrl(`explanations/${paperId}.json`)).then((r) => {
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`explanations/${paperId}.json ${r.status}`)
      return r.json()
    })
    p.catch(() => files.delete(paperId)) // 失敗的下次重抓
    files.set(paperId, p)
  }
  return p
}

export async function loadExplanation(questionId: string, number: number): Promise<{ model: string; item: Explanation } | null> {
  const file = await loadFile(paperOf(questionId))
  const item = file?.questions[String(number)]
  return file && item ? { model: file.model, item } : null
}

/** 題庫搜尋用：一份考卷的詳解全文，題目 id → 文字（沒有詳解的考卷回傳空的） */
export async function loadExplanationTexts(paperId: string): Promise<Map<string, string>> {
  const file = await loadFile(paperId)
  const pad = (n: string) => n.padStart(3, '0')
  return new Map(Object.entries(file?.questions ?? {}).map(([n, e]) => [`${paperId}_${pad(n)}`, e.text]))
}

export const LEVELS: Record<ExplanationLevel, { label: string; note: string }> = {
  checked: { label: '已比對', note: '和參考詳解的結論一致，名詞也檢查過。仍可能有參考詳解沒涵蓋的錯誤。' },
  terms: { label: '名詞可能有誤', note: '結論和參考詳解一致，但有名詞的中文譯名可能不對，見下方。' },
  conflict: { label: '和參考詳解不同', note: '這篇詳解有部分結論和參考詳解衝突，可能有錯，請以課本為準。' },
  unchecked: { label: '未經比對', note: '這題沒有參考詳解可以比對，正確性沒有檢查過。' },
}
