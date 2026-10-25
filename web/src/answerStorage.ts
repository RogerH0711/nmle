// 作答紀錄存進 localStorage 的格式（不依賴瀏覽器環境，方便測試）。
// localStorage 每個網站約 5 MB，原本存成 JSON 一筆約 130 字，3–4 萬筆就滿了，滿了之後新的作答會默默存不進去。
// v2 一筆一行、欄位用逗號分開、時間存成 36 進位的毫秒數，一筆約 65 字，容量多一倍。
import type { Letter } from './types'

export interface StoredAnswer {
  id: string
  question_id: string
  picked: Letter
  correct: boolean
  answered_at: string // ISO 時間
  synced: boolean
}

/** 一筆一行：id,題目 id,選的答案,對錯,作答時間,是否已同步 */
export function encodeAnswers(records: StoredAnswer[]): string {
  return records
    .map((r) => [r.id, r.question_id, r.picked, r.correct ? 1 : 0, Date.parse(r.answered_at).toString(36), r.synced ? 1 : 0].join(','))
    .join('\n')
}

export function decodeAnswers(text: string): StoredAnswer[] {
  const out: StoredAnswer[] = []
  for (const line of text.split('\n')) {
    const [id, question_id, picked, correct, at, synced] = line.split(',')
    if (!id || synced === undefined) continue // 空字串或壞掉的一行
    out.push({
      id,
      question_id,
      picked: picked as Letter,
      correct: correct === '1',
      answered_at: new Date(parseInt(at, 36)).toISOString(),
      synced: synced === '1',
    })
  }
  return out
}

/** v1 是 JSON 陣列；時間格式統一成前端的 ISO（資料庫回傳的是 +00:00） */
export function decodeLegacyAnswers(json: string): StoredAnswer[] {
  return (JSON.parse(json) as StoredAnswer[]).map((r) => ({ ...r, answered_at: new Date(r.answered_at).toISOString() }))
}
