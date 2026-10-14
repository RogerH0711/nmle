import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ExamFile, Index, Letter, Question } from './types'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']
const BASE = import.meta.env.BASE_URL

type Order = 'seq' | 'random'

// 一回合的狀態：題目順序、目前位置、每題選了什麼。存在 localStorage，重新整理不會不見。
interface Run {
  paperId: string
  subject: string
  order: Order
  queue: string[]
  pos: number
  picks: Record<string, Letter>
}

const RUN_KEY = 'nmle.run.v1'

function loadRun(): Run | null {
  try {
    const raw = localStorage.getItem(RUN_KEY)
    return raw ? (JSON.parse(raw) as Run) : null
  } catch {
    return null
  }
}

function saveRun(run: Run) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run))
  } catch {
    // 無痕模式等情況存不了，就只在這次瀏覽有效
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function isCorrect(q: Question, pick: Letter) {
  return q.free_point || q.answers.includes(pick)
}

function buildQueue(questions: Question[], subject: string, order: Order) {
  const pool = questions.filter((q) => q.valid && (subject === 'all' || q.subject === subject))
  const ids = pool.map((q) => q.id)
  return order === 'random' ? shuffle(ids) : ids
}

// 之後換成角色台詞（data/lines/*.json）；先用通用回饋
const FEEDBACK = {
  correct: ['答對了！', '漂亮！', '正確！', '很穩！'],
  wrong: ['差一點，看一下正解。', '這題記下來，之後再複習。', '沒關係，下一題。'],
}

function pickLine(kind: keyof typeof FEEDBACK, seed: number) {
  const lines = FEEDBACK[kind]
  return lines[seed % lines.length]
}

export default function App() {
  const [index, setIndex] = useState<Index | null>(null)
  const [exam, setExam] = useState<ExamFile | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 載入考卷清單，恢復上次的回合
  useEffect(() => {
    fetch(`${BASE}index.json`)
      .then((r) => r.json())
      .then((idx: Index) => {
        setIndex(idx)
        const saved = loadRun()
        const paperId = saved && idx.papers.some((p) => p.id === saved.paperId) ? saved.paperId : idx.papers[0]?.id
        if (paperId) openPaper(idx, paperId, saved?.paperId === paperId ? saved : null)
      })
      .catch(() => setError('題庫載入失敗'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openPaper = (idx: Index, paperId: string, resume: Run | null, subject = 'all', order: Order = 'seq') => {
    const info = idx.papers.find((p) => p.id === paperId)!
    fetch(`${BASE}${info.file}`)
      .then((r) => r.json())
      .then((data: ExamFile) => {
        setExam(data)
        const valid = new Set(data.questions.filter((q) => q.valid).map((q) => q.id))
        if (resume && resume.queue.every((id) => valid.has(id))) {
          setRun(resume)
        } else {
          setRun({ paperId, subject, order, queue: buildQueue(data.questions, subject, order), pos: 0, picks: {} })
        }
      })
      .catch(() => setError('考卷載入失敗'))
  }

  useEffect(() => {
    if (run) saveRun(run)
  }, [run])

  const byId = useMemo(() => new Map(exam?.questions.map((q) => [q.id, q]) ?? []), [exam])
  const done = run ? run.pos >= run.queue.length : false
  const current = run && !done ? byId.get(run.queue[run.pos]) : undefined
  const picked = current && run ? run.picks[current.id] : undefined

  const stats = useMemo(() => {
    if (!run) return { answered: 0, correct: 0 }
    let answered = 0
    let correct = 0
    for (const id of run.queue) {
      const q = byId.get(id)
      const p = run.picks[id]
      if (q && p) {
        answered++
        if (isCorrect(q, p)) correct++
      }
    }
    return { answered, correct }
  }, [run, byId])

  const pick = useCallback(
    (letter: Letter) => {
      if (!run || !current || picked) return
      setRun({ ...run, picks: { ...run.picks, [current.id]: letter } })
    },
    [run, current, picked],
  )

  const go = useCallback(
    (delta: number) => {
      if (!run) return
      const pos = Math.max(0, Math.min(run.queue.length, run.pos + delta))
      setRun({ ...run, pos })
    },
    [run],
  )

  const restart = (subject: string, order: Order, onlyWrong = false) => {
    if (!exam || !run || !index) return
    let queue = buildQueue(exam.questions, subject, order)
    if (onlyWrong) {
      queue = run.queue.filter((id) => {
        const q = byId.get(id)
        const p = run.picks[id]
        return q && p && !isCorrect(q, p)
      })
      if (order === 'random') queue = shuffle(queue)
    }
    setRun({ paperId: run.paperId, subject, order, queue, pos: 0, picks: {} })
  }

  // 鍵盤：1–4 或 A–D 作答，Enter／→ 下一題，← 上一題
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('select, input, textarea')) return
      const k = e.key.toUpperCase()
      const n = '1234'.indexOf(k)
      if (n >= 0) pick(LETTERS[n])
      else if (LETTERS.includes(k as Letter)) pick(k as Letter)
      else if ((k === 'ENTER' || k === 'ARROWRIGHT') && picked) go(1)
      else if (k === 'ARROWLEFT') go(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick, go, picked])

  if (error) return <div className="center">{error}</div>
  if (!index || !exam || !run) return <div className="center">載入中…</div>

  const subjectsInPaper = [...new Set(exam.questions.map((q) => q.subject).filter(Boolean))] as string[]
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0

  return (
    <div className="app">
      <header className="bar">
        <h1>一階刷題</h1>
        <div className="controls">
          <select
            aria-label="考卷"
            value={run.paperId}
            onChange={(e) => openPaper(index, e.target.value, null)}
          >
            {index.papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.year} 年{p.session ? `第 ${p.session} 次` : ''} {p.paper}
              </option>
            ))}
          </select>
          <select aria-label="學科" value={run.subject} onChange={(e) => restart(e.target.value, run.order)}>
            <option value="all">全部學科</option>
            {subjectsInPaper.map((s) => (
              <option key={s} value={s}>
                {index.subjects[s] ?? s}
              </option>
            ))}
          </select>
          <select
            aria-label="順序"
            value={run.order}
            onChange={(e) => restart(run.subject, e.target.value as Order)}
          >
            <option value="seq">依題號</option>
            <option value="random">隨機</option>
          </select>
        </div>
      </header>

      <div className="progress" aria-hidden>
        <div style={{ width: `${(Math.min(run.pos, run.queue.length) / Math.max(run.queue.length, 1)) * 100}%` }} />
      </div>
      <div className="meta">
        <span>
          {Math.min(run.pos + 1, run.queue.length)} / {run.queue.length}
        </span>
        <span>
          答對 {stats.correct} / {stats.answered}（{accuracy}%）
        </span>
      </div>

      {done ? (
        <Summary
          run={run}
          byId={byId}
          subjects={index.subjects}
          onRestart={() => restart(run.subject, run.order)}
          onRetryWrong={() => restart(run.subject, run.order, true)}
        />
      ) : current ? (
        <QuestionCard
          q={current}
          picked={picked}
          subjects={index.subjects}
          onPick={pick}
          onNext={() => go(1)}
          onPrev={run.pos > 0 ? () => go(-1) : undefined}
          seed={run.pos}
        />
      ) : (
        <div className="center">這個範圍沒有可作答的題目</div>
      )}
    </div>
  )
}

function QuestionCard(props: {
  q: Question
  picked: Letter | undefined
  subjects: Record<string, string>
  onPick: (l: Letter) => void
  onNext: () => void
  onPrev?: () => void
  seed: number
}) {
  const { q, picked, subjects, onPick, onNext, onPrev, seed } = props
  const correct = picked ? isCorrect(q, picked) : null

  return (
    <main className="card">
      <div className="qhead">
        <span className="qnum">第 {q.number} 題</span>
        {q.subject && (
          <span className="tag" title={q.subject_status === 'range' ? '依題號區段粗分，尚未逐題確認' : undefined}>
            {subjects[q.subject] ?? q.subject}
          </span>
        )}
        {q.free_point && <span className="tag warn">本題一律給分</span>}
        {!q.free_point && q.answers.length > 1 && <span className="tag warn">一題多解</span>}
      </div>

      <p className="stem">{q.stem}</p>
      {q.images.map((src) => (
        <img key={src} className="figure" src={`${BASE}${src}`} alt={`第 ${q.number} 題附圖`} />
      ))}

      <ol className="options">
        {q.options.map((text, i) => {
          const letter = LETTERS[i]
          let state = ''
          if (picked) {
            if (q.answers.includes(letter) && !q.free_point) state = 'is-answer'
            if (letter === picked) state += correct ? ' is-right' : ' is-wrong'
          }
          return (
            <li key={letter}>
              <button className={`option ${state}`} onClick={() => onPick(letter)} disabled={!!picked}>
                <span className="key">{letter}</span>
                <span className="text">{text}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {picked && (
        <div className={`feedback ${correct ? 'good' : 'bad'}`} role="status">
          <p className="line">{pickLine(correct ? 'correct' : 'wrong', seed)}</p>
          <p className="answer">
            {q.free_point ? '本題官方一律給分。' : `正解：${q.answers.join('、')}`}
            {q.answer_note && !q.free_point && <span className="note">（{q.answer_note}）</span>}
          </p>
        </div>
      )}

      <nav className="nav">
        <button className="ghost" onClick={onPrev} disabled={!onPrev}>
          ← 上一題
        </button>
        <button className="primary" onClick={onNext} disabled={!picked}>
          下一題 →
        </button>
      </nav>
      <p className="hint">鍵盤：1–4 作答，Enter 下一題</p>
    </main>
  )
}

function Summary(props: {
  run: Run
  byId: Map<string, Question>
  subjects: Record<string, string>
  onRestart: () => void
  onRetryWrong: () => void
}) {
  const { run, byId, subjects, onRestart, onRetryWrong } = props
  const rows = new Map<string, { total: number; correct: number }>()
  let wrong = 0
  for (const id of run.queue) {
    const q = byId.get(id)
    const p = run.picks[id]
    if (!q || !p) continue
    const key = q.subject ?? 'unknown'
    const row = rows.get(key) ?? { total: 0, correct: 0 }
    row.total++
    if (isCorrect(q, p)) row.correct++
    else wrong++
    rows.set(key, row)
  }

  return (
    <main className="card summary">
      <h2>這回合結束</h2>
      <table>
        <thead>
          <tr>
            <th>學科</th>
            <th>答對</th>
            <th>正確率</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].map(([key, r]) => (
            <tr key={key}>
              <td>{subjects[key] ?? '未分類'}</td>
              <td>
                {r.correct} / {r.total}
              </td>
              <td>{Math.round((r.correct / r.total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="nav">
        <button className="ghost" onClick={onRestart}>
          重新開始
        </button>
        <button className="primary" onClick={onRetryWrong} disabled={wrong === 0}>
          重做錯題（{wrong}）
        </button>
      </nav>
    </main>
  )
}
