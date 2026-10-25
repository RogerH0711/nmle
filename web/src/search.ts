// 題庫瀏覽與搜尋的比對（不依賴瀏覽器環境，方便測試）。做法見 docs/design.md「題庫瀏覽與搜尋」。
import type { Question } from './types'

// 一個字的比對形式：全形轉半形（NFKC）、英文不分大小寫、空白略過。
// 考卷有的在中文和英數字之間留空格、有的沒有（「第 2 天」「第2天」），略過空白才找得到兩種寫法。
function foldChar(c: string) {
  return /\s/.test(c) ? '' : c.normalize('NFKC').toLowerCase()
}

export function fold(text: string) {
  return [...text].map(foldChar).join('')
}

/** 搜尋框的字：空白分開的每一段都要出現（AND） */
export function parseQuery(query: string): string[] {
  return query.split(/\s+/).map(fold).filter(Boolean)
}

export interface BankFilter {
  scope: string // 'all'、'y113'（某年全部考卷）或考卷 id
  subject: string // 'all' 或學科 id
  terms: string[]
}

/** 考卷 id 是否在範圍內：115090_1 的年度是前三碼 */
export function inScope(paperId: string, scope: string) {
  if (scope === 'all') return true
  if (scope.startsWith('y')) return paperId.slice(0, 3) === scope.slice(1)
  return paperId === scope
}

export interface Hit {
  q: Question
  inExplanation: boolean // 題目沒有、只有詳解提到
}

// 題幹加選項的比對形式，每題只算一次（搜尋框每打一個字都會重新篩）
const folded = new WeakMap<Question, string>()
function foldQuestion(q: Question) {
  let f = folded.get(q)
  if (f === undefined) folded.set(q, (f = fold([q.stem, ...q.options].join('\n'))))
  return f
}

/**
 * 依範圍、學科、關鍵字篩出題目。explanations：題目 id → 詳解全文（已經 fold 過），有給才搜詳解。
 * 只列可出題的題目（valid），順序照傳進來的（考卷、題號）。
 */
export function searchBank(questions: Question[], filter: BankFilter, explanations?: Map<string, string>): Hit[] {
  const hits: Hit[] = []
  for (const q of questions) {
    if (!q.valid) continue
    if (filter.subject !== 'all' && q.subject !== filter.subject) continue
    if (!inScope(q.id.slice(0, q.id.lastIndexOf('_')), filter.scope)) continue
    if (!filter.terms.length) {
      hits.push({ q, inExplanation: false })
      continue
    }
    const own = foldQuestion(q)
    if (filter.terms.every((t) => own.includes(t))) {
      hits.push({ q, inExplanation: false })
      continue
    }
    const exp = explanations?.get(q.id)
    if (!exp) continue
    const all = own + '\n' + exp
    if (filter.terms.every((t) => all.includes(t))) hits.push({ q, inExplanation: true })
  }
  return hits
}

/** 把原文切成一般文字和符合關鍵字的片段，畫面上標示用。比對規則和 searchBank 一樣（略過空白、不分全半形大小寫）。 */
export function highlight(text: string, terms: string[]): { text: string; mark: boolean }[] {
  if (!terms.length) return [{ text, mark: false }]
  const chars = [...text]
  // 比對字串的每個字對應到原文第幾個字
  let folded = ''
  const origin: number[] = []
  chars.forEach((c, i) => {
    const f = foldChar(c)
    folded += f
    for (let k = 0; k < f.length; k++) origin.push(i) // 以 UTF-16 單位對應，和 indexOf 回傳的位置一致
  })
  const marked = new Array<boolean>(chars.length).fill(false)
  for (const t of terms) {
    for (let at = folded.indexOf(t); at >= 0; at = folded.indexOf(t, at + 1)) {
      const from = origin[at]
      const to = origin[at + t.length - 1]
      for (let i = from; i <= to; i++) marked[i] = true
    }
  }
  const parts: { text: string; mark: boolean }[] = []
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1]
    if (last && last.mark === marked[i]) last.text += c
    else parts.push({ text: c, mark: marked[i] })
  })
  return parts
}

// ---------- 網址 ----------
// #/bank/<範圍>[/<題號>][?q=關鍵字&s=學科]：範圍是 all、y113 或考卷 id。
// 可以把搜尋結果或某一題的網址分享出去；之後的 SEO 靜態頁也連回這裡。

export interface BankRoute {
  scope: string
  number: number | null // 只看這份考卷的這一題
  query: string
  subject: string
}

const SCOPE = /^(all|y\d{3}|\d{6}_\d)$/

export function parseBankHash(hash: string): BankRoute | null {
  const m = /^#\/bank(?:\/([^/?]+))?(?:\/(\d{1,3}))?\/?(?:\?(.*))?$/.exec(hash)
  if (!m) return null
  const scope = m[1] && SCOPE.test(m[1]) ? m[1] : 'all'
  const params = new URLSearchParams(m[3] ?? '')
  return {
    scope,
    number: m[2] && /^\d{6}_\d$/.test(scope) ? Number(m[2]) : null,
    query: params.get('q') ?? '',
    subject: params.get('s') ?? 'all',
  }
}

export function bankHash(r: BankRoute) {
  const params = new URLSearchParams()
  if (r.query.trim()) params.set('q', r.query.trim())
  if (r.subject !== 'all') params.set('s', r.subject)
  const qs = params.toString()
  return `#/bank/${r.scope}${r.number !== null ? `/${r.number}` : ''}${qs ? `?${qs}` : ''}`
}
