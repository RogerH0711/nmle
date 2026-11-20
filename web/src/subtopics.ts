// 次主題：學科底下再分一層（docs/subtopics.md）。每題的次主題由 pipeline/explain/classify.py 用本機 Qwen 判斷，
// 匯出成 data/subtopics.json（每份考卷一個陣列，第 n 個是第 n 題）。AI 分類可能有誤，畫面上要註明。
// 這個檔案前半段不依賴瀏覽器環境，方便測試；最下面是載入。
import { useEffect, useState } from 'react'
import type { AnswerRecord } from './answers'
import { dailyFirsts } from './affection.ts'

export interface SubtopicData {
  model: string
  subjects: Record<string, { id: string; name: string }[]>
  papers: Record<string, string[]>
}

export const MIN_SUB_ANSWERS = 5 // 次主題的題數比學科少，門檻放低
export const RECENT_SUB = 30 // 次主題看最近幾題

/** 題目的次主題 id；還沒分類、或不在資料裡的是 null */
export function subtopicOf(data: SubtopicData, questionId: string): string | null {
  const cut = questionId.lastIndexOf('_')
  return data.papers[questionId.slice(0, cut)]?.[Number(questionId.slice(cut + 1)) - 1] || null
}

export function subtopicName(data: SubtopicData, subject: string | null, id: string | null): string | null {
  if (!subject || !id) return null
  return data.subjects[subject]?.find((s) => s.id === id)?.name ?? null
}

/** 這個次主題的所有題號（依考卷、題號）。只列 papers 裡有的考卷 */
export function questionIdsOf(data: SubtopicData, subtopic: string, subjectOf: (id: string) => string | null, subject: string): string[] {
  const ids: string[] = []
  for (const [paper, row] of Object.entries(data.papers)) {
    row.forEach((sub, i) => {
      if (sub !== subtopic) return
      const id = `${paper}_${String(i + 1).padStart(3, '0')}`
      if (subjectOf(id) === subject) ids.push(id) // 不同學科可能有同名的 id（例如 neuro）
    })
  }
  return ids
}

export interface SubtopicAbility {
  id: string
  name: string
  answered: number // 作答次數（同一題同一天只算一次）
  covered: number // 寫過的不同題目
  total: number // 題庫裡的題數
  rate: number | null // 最近 RECENT_SUB 題的正確率（%）
}

/** 一個學科底下各次主題的能力值，順序照分類表 */
export function subtopicAbilities(
  data: SubtopicData,
  subject: string,
  records: AnswerRecord[],
  subjectOf: (id: string) => string | null,
): SubtopicAbility[] {
  const list = data.subjects[subject] ?? []
  const totals = new Map<string, number>()
  for (const [paper, row] of Object.entries(data.papers)) {
    row.forEach((sub, i) => {
      if (sub && subjectOf(`${paper}_${String(i + 1).padStart(3, '0')}`) === subject) totals.set(sub, (totals.get(sub) ?? 0) + 1)
    })
  }
  const mine = new Map<string, AnswerRecord[]>(list.map((s) => [s.id, []]))
  const sorted = [...records].sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at))
  for (const r of dailyFirsts(sorted)) {
    if (subjectOf(r.question_id) !== subject) continue
    mine.get(subtopicOf(data, r.question_id) ?? '')?.push(r)
  }
  return list.map((s) => {
    const rs = mine.get(s.id)!
    const recent = rs.slice(-RECENT_SUB)
    return {
      id: s.id,
      name: s.name,
      answered: rs.length,
      covered: new Set(rs.map((r) => r.question_id)).size,
      total: totals.get(s.id) ?? 0,
      rate: recent.length >= MIN_SUB_ANSWERS ? Math.round((recent.filter((r) => r.correct).length / recent.length) * 100) : null,
    }
  })
}

// ---------- 載入 ----------

let loading: Promise<SubtopicData | null> | null = null
let loaded: SubtopicData | null = null

function load(url: string): Promise<SubtopicData | null> {
  loading ??= fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<SubtopicData>) : null))
    .catch(() => null)
    .then((d) => (loaded = d))
  return loading
}

/** 次主題資料；還沒載入或還沒分類（沒有 data/subtopics.json）時是 null，畫面就不顯示次主題 */
export function useSubtopics(url: string): SubtopicData | null {
  const [data, setData] = useState(loaded)
  useEffect(() => {
    let alive = true
    void load(url).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [url])
  return data
}
