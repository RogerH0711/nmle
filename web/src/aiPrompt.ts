import type { Letter, PaperInfo, Question } from './types'

// 「問 AI」：作答後把題目整理成提問，讓使用者帶去自己慣用的 AI 問（網站的 AI 詳解之外，想追問或換個說法時用）。
// 網站本身不呼叫任何 AI，也不送出作答紀錄以外的資料。

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

// 網址帶入提問的上限（編碼後的長度）。太長的題目只複製，不放進網址
export const MAX_URL_PROMPT = 6000

export function askPrompt(q: Question, paper: PaperInfo | undefined, subject: string | null, picked: Letter): string {
  const source = paper
    ? `考選部 ${paper.year} 年${paper.session ? `第 ${paper.session} 次` : ''}醫師第一階段考試 ${paper.paper} 第 ${q.number} 題`
    : `醫師第一階段考試第 ${q.number} 題`
  const answer = q.free_point
    ? '官方公告本題一律給分（送分題）'
    : `${q.answers.join('、')}${q.answer_note ? `（${q.answer_note}）` : ''}`
  return [
    '請用繁體中文（台灣用語）解釋這題醫師國考一階的考題。',
    `出處：${source}${subject ? `（${subject}）` : ''}`,
    '',
    q.stem,
    ...q.options.map((o, i) => `(${LETTERS[i]}) ${o}`),
    ...(q.images.length ? ['', '（這題有附圖，我會另外貼上。）'] : []),
    '',
    `官方正解：${answer}`,
    `我選的是：${picked}`,
    '',
    '請說明：',
    q.free_point ? '1. 這題為什麼可能被送分' : `1. 為什麼正解是 ${q.answers.join('、')}`,
    '2. 其他選項各錯在哪裡',
    '3. 這題考的觀念，以及容易混淆的地方',
    '如果你認為官方答案有疑義，也請直接指出。',
  ].join('\n')
}

export const AI_SITES = [
  { id: 'chatgpt', name: 'ChatGPT', label: 'ChatGPT', url: (p: string) => `https://chatgpt.com/?q=${encodeURIComponent(p)}`, home: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', label: 'Claude', url: (p: string) => `https://claude.ai/new?q=${encodeURIComponent(p)}`, home: 'https://claude.ai/new' },
  { id: 'gemini', name: 'Gemini', label: 'Gemini（複製後貼上）', url: null, home: 'https://gemini.google.com/app' }, // Gemini 不支援網址帶入，只能貼上
] as const

/** 開哪個網址：提問太長或網站不支援帶入時，只開首頁（提問已經複製，貼上就好） */
export function siteUrl(site: (typeof AI_SITES)[number], prompt: string): { href: string; prefilled: boolean } {
  if (site.url) {
    const href = site.url(prompt)
    if (href.length <= MAX_URL_PROMPT) return { href, prefilled: true }
  }
  return { href: site.home, prefilled: false }
}
