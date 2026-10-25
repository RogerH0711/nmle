import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Index, Letter, Question } from './types'
import { imageUrl, loadPaper, paperLabel } from './bank'
import { loadExplanationTexts } from './explanations'
import { ExplanationPanel } from './ExplanationPanel'
import { ReportButton } from './Report'
import { bankHash, fold, highlight, inScope, parseQuery, searchBank, type BankRoute } from './search'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']
const PAGE = 30 // 一次列幾題，往下按「再顯示」

/**
 * 題庫：依年度、考卷、學科瀏覽題目，或用關鍵字搜尋（題幹、選項，可以加上詳解）。
 * 正解預設收合，按了才顯示。可以把找到的題目拿去刷題。見 docs/design.md「題庫瀏覽與搜尋」。
 */
export function QuestionBank(props: {
  index: Index
  initial: BankRoute
  onPractice: (ids: string[], label: string) => void
}) {
  const { index, onPractice } = props
  const [route, setRoute] = useState(props.initial)
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [withExplanations, setWithExplanations] = useState(false)
  const [explanations, setExplanations] = useState<Map<string, string> | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [error, setError] = useState(false)
  const query = useDeferredValue(route.query) // 打字時先更新輸入框，結果晚一點跟上

  const years = [...new Set(index.papers.map((p) => p.year))].sort((a, b) => b - a)
  const paperIds = useMemo(
    () => index.papers.filter((p) => inScope(p.id, route.scope)).map((p) => p.id),
    [index, route.scope],
  )

  // 網址跟著篩選條件走，可以分享或加書籤
  useEffect(() => {
    window.history.replaceState(null, '', bankHash(route))
  }, [route])

  useEffect(() => {
    let alive = true
    setQuestions(null)
    setError(false)
    Promise.all(paperIds.map((id) => loadPaper(index, id)))
      .then((files) => alive && setQuestions(files.flatMap((f) => f.questions)))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [index, paperIds])

  useEffect(() => {
    let alive = true
    setExplanations(null)
    if (!withExplanations) return
    Promise.all(paperIds.map(loadExplanationTexts))
      .then((maps) => {
        if (!alive) return
        setExplanations(new Map(maps.flatMap((m) => [...m].map(([id, text]) => [id, fold(text)] as const))))
      })
      .catch(() => alive && setWithExplanations(false))
    return () => {
      alive = false
    }
  }, [paperIds, withExplanations])

  const terms = useMemo(() => parseQuery(query), [query])
  const hits = useMemo(() => {
    if (!questions) return []
    const all = searchBank(questions, { scope: route.scope, subject: route.subject, terms }, explanations ?? undefined)
    return route.number === null ? all : all.filter((h) => h.q.number === route.number)
  }, [questions, route.scope, route.subject, route.number, terms, explanations])

  const update = (patch: Partial<BankRoute>) => {
    setRoute((r) => ({ ...r, number: null, ...patch }))
    setShown(PAGE)
  }

  const scopeLabel =
    route.scope === 'all' ? '全部考卷'
    : route.scope.startsWith('y') ? `${route.scope.slice(1)} 年全部考卷`
    : (() => {
        const p = index.papers.find((x) => x.id === route.scope)
        return p ? paperLabel(p) : route.scope
      })()
  const practiceLabel = [scopeLabel, route.subject !== 'all' && index.subjects[route.subject], query.trim() && `「${query.trim()}」`]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="bank">
      <div className="bank-filters">
        <input
          type="search"
          className="bank-search"
          aria-label="搜尋題目"
          placeholder="搜尋題目，例如 vancomycin、內側延腦"
          title="搜題幹和選項，不分大小寫；空白分開的幾個字要同時出現"
          value={route.query}
          onChange={(e) => update({ query: e.target.value })}
        />
        <div className="controls">
          <select aria-label="範圍" value={route.scope} onChange={(e) => update({ scope: e.target.value })}>
            <option value="all">全部考卷</option>
            {years.map((y) => (
              <optgroup key={y} label={`${y} 年`}>
                <option value={`y${y}`}>{y} 年全部</option>
                {index.papers
                  .filter((p) => p.year === y)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {paperLabel(p)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <select aria-label="學科" value={route.subject} onChange={(e) => update({ subject: e.target.value })}>
            <option value="all">全部學科</option>
            {Object.entries(index.subjects).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={withExplanations} onChange={(e) => setWithExplanations(e.target.checked)} />
            也搜詳解
          </label>
        </div>
      </div>

      <div className="bank-meta">
        {error ? (
          <span>題庫載入失敗，請重新整理</span>
        ) : !questions || (withExplanations && !explanations) ? (
          <span>載入中…</span>
        ) : route.number !== null ? (
          <button className="link" onClick={() => update({})}>
            ← 看整份 {scopeLabel}
          </button>
        ) : (
          <>
            <span>
              {scopeLabel}・{route.subject !== 'all' ? `${index.subjects[route.subject]}・` : ''}共 {hits.length} 題
            </span>
            {hits.length > 0 && (
              <button className="primary small" onClick={() => onPractice(hits.map((h) => h.q.id), practiceLabel)}>
                刷這 {hits.length} 題
              </button>
            )}
          </>
        )}
      </div>
      {route.subject !== 'all' && route.number === null && (
        <p className="hint">學科目前依題號區段粗分，還沒有逐題確認，可能有少數題目分錯。</p>
      )}

      <ol className="bank-list">
        {hits.slice(0, shown).map((h) => (
          <BankItem
            key={h.q.id}
            q={h.q}
            index={index}
            terms={terms}
            inExplanation={h.inExplanation}
            open={route.number !== null}
            onPermalink={() => update({ scope: h.q.id.slice(0, h.q.id.lastIndexOf('_')), number: h.q.number, query: '', subject: 'all' })}
          />
        ))}
      </ol>
      {hits.length > shown && (
        <button className="ghost bank-more" onClick={() => setShown(shown + PAGE)}>
          再顯示 {Math.min(PAGE, hits.length - shown)} 題（還有 {hits.length - shown} 題）
        </button>
      )}
      {questions && hits.length === 0 && !error && (
        <p className="center-note">
          找不到符合的題目。{!withExplanations && terms.length > 0 && '可以勾「也搜詳解」，或換成英文、中文的另一種寫法再試試。'}
        </p>
      )}
    </section>
  )
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : p.text))}
    </>
  )
}

function BankItem(props: {
  q: Question
  index: Index
  terms: string[]
  inExplanation: boolean
  open: boolean // 單題網址：直接展開正解
  onPermalink: () => void
}) {
  const { q, index, terms, inExplanation, onPermalink } = props
  const [revealed, setRevealed] = useState(props.open)
  const paper = index.papers.find((p) => q.id.startsWith(p.id + '_'))

  return (
    <li className="card bank-item">
      <div className="qhead">
        <button className="link qnum" title="這一題的網址" onClick={onPermalink}>
          {paper && `${paper.year}-${paper.session ?? ''} ${paper.paper} `}第 {q.number} 題
        </button>
        {q.subject && (
          <span className="tag" title={q.subject_status === 'range' ? '依題號區段粗分，尚未逐題確認' : undefined}>
            {index.subjects[q.subject] ?? q.subject}
          </span>
        )}
        {q.free_point && <span className="tag warn">本題一律給分</span>}
        {!q.free_point && q.answers.length > 1 && <span className="tag warn">一題多解</span>}
        {inExplanation && <span className="tag">詳解提到</span>}
      </div>

      <p className="stem">
        <Marked text={q.stem} terms={terms} />
      </p>
      {q.images.map((src) => (
        <img key={src} className="figure" src={imageUrl(src)} alt={`第 ${q.number} 題附圖`} loading="lazy" />
      ))}

      <ol className="bank-options">
        {q.options.map((text, i) => (
          <li key={i} className={revealed && !q.free_point && q.answers.includes(LETTERS[i]) ? 'is-answer' : undefined}>
            <span className="key">{LETTERS[i]}</span>
            <span>
              <Marked text={text} terms={terms} />
            </span>
          </li>
        ))}
      </ol>

      {revealed ? (
        <div className="bank-answer">
          <p className="answer">
            {q.free_point ? '本題官方一律給分。' : `正解：${q.answers.join('、')}`}
            {q.answer_note && !q.free_point && <span className="note">（{q.answer_note}）</span>}
          </p>
          <ExplanationPanel questionId={q.id} number={q.number} />
          <div className="card-foot">
            <ReportButton questionId={q.id} picked={undefined} />
          </div>
        </div>
      ) : (
        <button className="ghost small" onClick={() => setRevealed(true)}>
          顯示正解
        </button>
      )}
    </li>
  )
}
