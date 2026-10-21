import { useEffect, useState } from 'react'
import { parseExplanation } from './explanationText'
import { LEVELS, loadExplanation, type Explanation } from './explanations'

/**
 * 作答後的「看詳解」：AI 生成，預設收合，按了才展開。
 * 依比對結果標示分級；這份考卷或這題沒有詳解時不顯示任何東西。
 */
export function ExplanationPanel({ questionId, number }: { questionId: string; number: number }) {
  const [data, setData] = useState<{ model: string; item: Explanation } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    loadExplanation(questionId, number)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
    return () => {
      alive = false
    }
  }, [questionId, number])

  if (!data) return null
  const { item, model } = data
  const level = LEVELS[item.level]

  return (
    <div className={`explanation level-${item.level}`}>
      <button className="ghost small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起詳解' : '看詳解（AI 生成）'}
      </button>
      {!open && <span className="explanation-badge">{level.label}</span>}
      {open && (
        <div className="explanation-body">
          <p className="explanation-level">
            <span className="explanation-badge">{level.label}</span>
            {level.note}
          </p>
          {item.terms && (
            <ul className="explanation-terms">
              {item.terms.map((t) => (
                <li key={t.en}>
                  {t.en} 的中文應為「{t.correct}」
                </li>
              ))}
            </ul>
          )}
          {parseExplanation(item.text).map((b, i) => {
            const parts = b.parts.map((p, j) => (p.bold ? <strong key={j}>{p.text}</strong> : p.text))
            if (b.kind === 'heading') return <h4 key={i}>{parts}</h4>
            return b.kind === 'item' ? (
              <p key={i} className="explanation-item">
                {parts}
              </p>
            ) : (
              <p key={i}>{parts}</p>
            )
          })}
          <p className="explanation-foot">
            由 {model} 生成，沒有經過人工審核，和課本或官方答案不同時以課本與考選部為準。發現錯誤請用下方「回報疑義」選「詳解有誤」。
            名詞對照參考國家教育研究院「學術名詞」（政府資料開放授權條款第 1 版）。
          </p>
        </div>
      )}
    </div>
  )
}
