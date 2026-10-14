import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Index, Letter, Question } from './types'
import { imageUrl, loadIndex, loadPaper, loadQuestions } from './bank'
import { recordAnswer, switchUser, syncNow, useAnswers, type SyncStatus } from './answers'
import { reviewStates, reviewSummary } from './review'
import { signInWithGoogle, signOut, supabase } from './supabase'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

type Order = 'seq' | 'random'

// 一回合：依考卷刷題（paper）或錯題複習（review）。題目可以跨考卷，用題目 id 串起來。
// 存在 localStorage，重新整理不會不見。
interface Run {
  kind: 'paper' | 'review'
  paperId: string | null
  subject: string
  order: Order
  queue: string[]
  pos: number
  picks: Record<string, Letter>
}

const RUN_KEY = 'nmle.run.v2'

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

function paperQueue(questions: Question[], subject: string, order: Order) {
  const ids = questions.filter((q) => q.valid && (subject === 'all' || q.subject === subject)).map((q) => q.id)
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
  const [questions, setQuestions] = useState<Map<string, Question>>(new Map())
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const answers = useAnswers()

  // 登入狀態：切換本機紀錄的擁有者並同步。
  // supabase 文件提醒不要在 onAuthStateChange 裡直接呼叫其他 supabase API，所以延後執行。
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setTimeout(() => void switchUser(session?.user.id ?? null), 0)
      if (event === 'SIGNED_IN' && window.location.search.includes('code=')) {
        window.history.replaceState(null, '', window.location.pathname) // 拿掉 OAuth 回傳的 ?code=
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // 讓一回合的題目都載入後再開始
  const startRun = useCallback(async (idx: Index, next: Run) => {
    try {
      const map = await loadQuestions(idx, next.queue)
      setQuestions((prev) => new Map([...prev, ...map]))
      setRun({ ...next, queue: next.queue.filter((id) => map.get(id)?.valid) })
    } catch {
      setError('題庫載入失敗')
    }
  }, [])

  const openPaper = useCallback(
    async (idx: Index, paperId: string, subject = 'all', order: Order = 'seq') => {
      try {
        const file = await loadPaper(idx, paperId)
        await startRun(idx, {
          kind: 'paper', paperId, subject, order,
          queue: paperQueue(file.questions, subject, order), pos: 0, picks: {},
        })
      } catch {
        setError('考卷載入失敗')
      }
    },
    [startRun],
  )

  // 載入考卷清單，恢復上次的回合
  useEffect(() => {
    loadIndex()
      .then((idx) => {
        setIndex(idx)
        const saved = loadRun()
        if (saved && saved.queue.length) void startRun(idx, saved)
        else if (idx.papers[0]) void openPaper(idx, idx.papers[0].id)
      })
      .catch(() => setError('題庫載入失敗'))
  }, [startRun, openPaper])

  useEffect(() => {
    if (run) saveRun(run)
  }, [run])

  const review = useMemo(() => reviewSummary(reviewStates(answers.records)), [answers.records])
  const done = run ? run.pos >= run.queue.length : false
  const current = run && !done ? questions.get(run.queue[run.pos]) : undefined
  const picked = current && run ? run.picks[current.id] : undefined

  const stats = useMemo(() => {
    let answered = 0
    let correct = 0
    for (const id of run?.queue ?? []) {
      const q = questions.get(id)
      const p = run?.picks[id]
      if (q && p) {
        answered++
        if (isCorrect(q, p)) correct++
      }
    }
    return { answered, correct }
  }, [run, questions])

  const pick = useCallback(
    (letter: Letter) => {
      if (!run || !current || picked) return
      setRun({ ...run, picks: { ...run.picks, [current.id]: letter } })
      recordAnswer(current.id, letter, isCorrect(current, letter))
    },
    [run, current, picked],
  )

  const go = useCallback(
    (delta: number) => {
      if (!run) return
      setRun({ ...run, pos: Math.max(0, Math.min(run.queue.length, run.pos + delta)) })
    },
    [run],
  )

  const restart = (subject: string, order: Order, onlyWrong = false) => {
    if (!index || !run) return
    if (onlyWrong) {
      const wrong = run.queue.filter((id) => {
        const q = questions.get(id)
        const p = run.picks[id]
        return q && p && !isCorrect(q, p)
      })
      setRun({ ...run, subject, order, queue: order === 'random' ? shuffle(wrong) : wrong, pos: 0, picks: {} })
    } else if (run.kind === 'review') {
      startReview()
    } else if (run.paperId) {
      void openPaper(index, run.paperId, subject, order)
    }
  }

  const startReview = () => {
    if (!index || !review.due.length) return
    void startRun(index, { kind: 'review', paperId: null, subject: 'all', order: 'seq', queue: review.due, pos: 0, picks: {} })
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
  if (!index || !run) return <div className="center">載入中…</div>

  const paperQuestions = run.paperId ? [...questions.values()].filter((q) => q.id.startsWith(run.paperId + '_')) : []
  const subjectsInPaper = [...new Set(paperQuestions.map((q) => q.subject).filter(Boolean))] as string[]
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0

  return (
    <div className="app">
      <header className="bar">
        <h1>一階刷題</h1>
        <Account user={user} status={answers.status} pending={answers.records.filter((r) => !r.synced).length} />
      </header>

      <section className="review">
        <div>
          <strong>錯題複習</strong>
          <span className="review-stats">
            今天到期 {review.due.length} 題・等待中 {review.waiting}・已攻略 {review.done}
          </span>
        </div>
        <button className="primary small" onClick={startReview} disabled={!review.due.length || run.kind === 'review'}>
          {run.kind === 'review' ? '複習中' : '開始複習'}
        </button>
      </section>

      <div className="controls">
        <select
          aria-label="考卷"
          value={run.kind === 'paper' ? (run.paperId ?? '') : ''}
          onChange={(e) => void openPaper(index, e.target.value)}
        >
          {run.kind === 'review' && <option value="">（錯題複習）</option>}
          {index.papers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year} 年{p.session ? `第 ${p.session} 次` : ''} {p.paper}
            </option>
          ))}
        </select>
        {run.kind === 'paper' && (
          <>
            <select aria-label="學科" value={run.subject} onChange={(e) => restart(e.target.value, run.order)}>
              <option value="all">全部學科</option>
              {subjectsInPaper.map((s) => (
                <option key={s} value={s}>
                  {index.subjects[s] ?? s}
                </option>
              ))}
            </select>
            <select aria-label="順序" value={run.order} onChange={(e) => restart(run.subject, e.target.value as Order)}>
              <option value="seq">依題號</option>
              <option value="random">隨機</option>
            </select>
          </>
        )}
      </div>

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
          questions={questions}
          subjects={index.subjects}
          onRestart={run.kind === 'paper' ? () => restart(run.subject, run.order) : undefined}
          onRetryWrong={() => restart(run.subject, run.order, true)}
        />
      ) : current ? (
        <QuestionCard
          q={current}
          index={index}
          picked={picked}
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

const STATUS_TEXT: Record<SyncStatus, string> = {
  local: '只存在這台裝置',
  syncing: '同步中…',
  synced: '已同步',
  offline: '離線，連線後自動同步',
  error: '同步失敗',
}

function Account({ user, status, pending }: { user: User | null; status: SyncStatus; pending: number }) {
  if (!user) {
    return (
      <div className="account">
        <span className="sync">{STATUS_TEXT.local}</span>
        <button className="ghost small" onClick={() => void signInWithGoogle()}>
          用 Google 登入
        </button>
      </div>
    )
  }
  const name = (user.user_metadata?.name as string | undefined) ?? user.email
  return (
    <div className="account">
      <span className={`sync ${status}`} title={pending ? `${pending} 筆尚未上傳` : undefined}>
        {STATUS_TEXT[status]}
      </span>
      {status === 'error' && (
        <button className="ghost small" onClick={() => void syncNow()}>
          重試
        </button>
      )}
      <span className="name">{name}</span>
      <button className="ghost small" onClick={() => void signOut()}>
        登出
      </button>
    </div>
  )
}

function QuestionCard(props: {
  q: Question
  index: Index
  picked: Letter | undefined
  onPick: (l: Letter) => void
  onNext: () => void
  onPrev?: () => void
  seed: number
}) {
  const { q, index, picked, onPick, onNext, onPrev, seed } = props
  const correct = picked ? isCorrect(q, picked) : null
  const paper = index.papers.find((p) => q.id.startsWith(p.id + '_'))

  return (
    <main className="card">
      <div className="qhead">
        <span className="qnum">
          {paper && `${paper.year}-${paper.session ?? ''} ${paper.paper} `}第 {q.number} 題
        </span>
        {q.subject && (
          <span className="tag" title={q.subject_status === 'range' ? '依題號區段粗分，尚未逐題確認' : undefined}>
            {index.subjects[q.subject] ?? q.subject}
          </span>
        )}
        {q.free_point && <span className="tag warn">本題一律給分</span>}
        {!q.free_point && q.answers.length > 1 && <span className="tag warn">一題多解</span>}
      </div>

      <p className="stem">{q.stem}</p>
      {q.images.map((src) => (
        <img key={src} className="figure" src={imageUrl(src)} alt={`第 ${q.number} 題附圖`} />
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
  questions: Map<string, Question>
  subjects: Record<string, string>
  onRestart?: () => void
  onRetryWrong: () => void
}) {
  const { run, questions, subjects, onRestart, onRetryWrong } = props
  const rows = new Map<string, { total: number; correct: number }>()
  let wrong = 0
  for (const id of run.queue) {
    const q = questions.get(id)
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
      <h2>{run.kind === 'review' ? '今天的複習完成了' : '這回合結束'}</h2>
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
        {onRestart ? (
          <button className="ghost" onClick={onRestart}>
            重新開始
          </button>
        ) : (
          <span />
        )}
        <button className="primary" onClick={onRetryWrong} disabled={wrong === 0}>
          重做錯題（{wrong}）
        </button>
      </nav>
    </main>
  )
}
