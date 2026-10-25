import { dataUrl, paperOf } from './bank'

// AI 生成的詳解：pipeline/explain/export_web.py 匯出到 data/explanations/<考卷>.json。
// 分級說明見 docs/design.md「詳解與題目正確率」。

import type { ExplanationLevel } from './explanationText'
export type { ExplanationLevel }

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

export { LEVELS } from './explanationText'
