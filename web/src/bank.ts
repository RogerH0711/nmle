import type { ExamFile, Index, PaperInfo, Question } from './types'

const BASE = import.meta.env.BASE_URL
const papers = new Map<string, Promise<ExamFile>>()

// 部署時的 commit（GitHub Actions 帶入 VITE_BUILD）。資料檔網址加上它，每次部署都會抓新的：
// GitHub Pages 讓瀏覽器快取每個檔案 10 分鐘，不加的話剛部署完可能新程式配到舊的題庫或角色設定。
export const BUILD = (import.meta.env.VITE_BUILD as string | undefined)?.slice(0, 7) ?? 'dev'

/** 資料檔網址（相對於網站根目錄），加上版本號 */
export const dataUrl = (path: string) => `${BASE}${path}?v=${BUILD}`

export function loadIndex(): Promise<Index> {
  return fetch(dataUrl('index.json')).then((r) => {
    if (!r.ok) throw new Error(`index.json ${r.status}`)
    return r.json()
  })
}

/** 題目 id 前綴就是考卷 id：115090_1_062 → 115090_1 */
export function paperOf(questionId: string) {
  return questionId.slice(0, questionId.lastIndexOf('_'))
}

export function loadPaper(index: Index, paperId: string): Promise<ExamFile> {
  let p = papers.get(paperId)
  if (!p) {
    const info = index.papers.find((x) => x.id === paperId)
    if (!info) return Promise.reject(new Error(`找不到考卷 ${paperId}`))
    p = fetch(dataUrl(info.file)).then((r) => {
      if (!r.ok) throw new Error(`${info.file} ${r.status}`)
      return r.json()
    })
    p.catch(() => papers.delete(paperId)) // 失敗的下次重抓
    papers.set(paperId, p)
  }
  return p
}

/** 載入這些題目所在的考卷，回傳 id → 題目。 */
export async function loadQuestions(index: Index, ids: string[]): Promise<Map<string, Question>> {
  const paperIds = [...new Set(ids.map(paperOf))].filter((id) => index.papers.some((p) => p.id === id))
  const files = await Promise.all(paperIds.map((id) => loadPaper(index, id)))
  return new Map(files.flatMap((f) => f.questions.map((q) => [q.id, q] as const)))
}

export const imageUrl = (path: string) => `${BASE}${path}`

/** 115 年第 2 次 醫學(一) */
export const paperLabel = (p: PaperInfo) => `${p.year} 年${p.session ? `第 ${p.session} 次` : ''} ${p.paper}`
