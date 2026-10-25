import { useState } from 'react'
import type { Letter, PaperInfo, Question } from './types'
import { AI_SITES, askPrompt, siteUrl } from './aiPrompt'

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 作答後的「問 AI」：把題目、選項、正解和你選的答案整理成提問，
 * 複製起來並打開 AI 網站。ChatGPT、Claude 會自動帶入；Gemini 和太長的題目要自己貼上。
 */
export function AskAi(props: { q: Question; paper: PaperInfo | undefined; subject: string | null; picked: Letter }) {
  const [status, setStatus] = useState<string | null>(null)
  const [manual, setManual] = useState(false) // 複製失敗：顯示提問讓使用者自己選取
  const prompt = askPrompt(props.q, props.paper, props.subject, props.picked)
  const hasImage = props.q.images.length > 0

  const open = async (site: (typeof AI_SITES)[number]) => {
    // 先開視窗再複製：有些瀏覽器只在使用者點擊的當下允許開新分頁
    const { href, prefilled } = siteUrl(site, prompt)
    window.open(href, '_blank', 'noopener')
    const copied = await copy(prompt)
    if (!prefilled && !copied) setManual(true)
    setStatus(
      prefilled
        ? `已在 ${site.name} 帶入題目${hasImage ? '，記得把附圖也貼上' : ''}。`
        : copied
          ? `已複製題目。${site.name} 不會自動帶入，請在對話框按 Ctrl+V（手機長按）貼上${hasImage ? '（附圖要另外貼上）' : ''}。`
          : `瀏覽器不讓網站複製文字，請選取下面的提問，貼到 ${site.name}。`,
    )
  }

  const copyOnly = async () => {
    const copied = await copy(prompt)
    setManual(!copied)
    setStatus(copied ? `已複製題目${hasImage ? '（附圖要另外貼上）' : ''}，貼到任何 AI 都能問。` : '瀏覽器不讓網站複製文字，請選取下面的提問。')
  }

  return (
    <div className="ask-ai">
      <span className="ask-ai-label">看不懂為什麼？問 AI：</span>
      {AI_SITES.map((s) => (
        <button key={s.id} className="ghost small" onClick={() => void open(s)}>
          {s.label}
        </button>
      ))}
      <button className="ghost small" onClick={() => void copyOnly()}>
        複製題目
      </button>
      {status && (
        <p className="ask-ai-status" role="status">
          {status}
        </p>
      )}
      {manual && <textarea className="ask-ai-text" readOnly rows={6} value={prompt} onFocus={(e) => e.currentTarget.select()} />}
      <p className="ask-ai-note">AI 的解釋不一定正確，和課本或官方答案不一樣時，以課本與考選部為準。</p>
    </div>
  )
}
