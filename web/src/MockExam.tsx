import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ExamFile, Index, Letter, Question } from './types'
import { imageUrl, loadPaper, paperLabel } from './bank'
import {
  deadline, firstAttempts, formatClock, isMockCorrect, MIN_RANKED_MINUTES, MOCK_MINUTES, PASS_SCORE, scoreMock, tooQuick,
  type MockRecord, type MockSession,
} from './mock'
import { CharacterStage } from './CharacterStage'
import type { Reaction } from './characters'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']
const LOW_TIME_MS = 10 * 60_000 // 剩 10 分鐘時倒數變紅

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

const duration = (r: MockRecord) => formatClock(new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime())

/** 載入這些考卷（模擬考紀錄算分數用） */
function usePapers(index: Index, paperIds: string[]) {
  const [files, setFiles] = useState<Map<string, ExamFile>>(new Map())
  const key = [...new Set(paperIds)].sort().join(',')
  useEffect(() => {
    if (!key) return
    let alive = true
    Promise.all(key.split(',').map((id) => loadPaper(index, id).then((f) => [id, f] as const)))
      .then((entries) => alive && setFiles(new Map(entries)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [index, key])
  return files
}

// ---------- 選考卷、歷次成績 ----------

export function MockHome(props: {
  index: Index
  records: MockRecord[]
  user: User | null
  syncError: string | null
  onStart: (paperId: string) => void
  onOpen: (recordId: string) => void
}) {
  const { index, records, user, syncError, onStart, onOpen } = props
  const files = usePapers(index, records.map((r) => r.paper_id))
  const firsts = useMemo(() => firstAttempts(records), [records])
  const score = (r: MockRecord) => {
    const f = files.get(r.paper_id)
    return f ? scoreMock(f.questions, r.picks) : null
  }
  const byPaper = new Map<string, MockRecord[]>()
  for (const r of records) byPaper.set(r.paper_id, [...(byPaper.get(r.paper_id) ?? []), r])

  return (
    <main className="card mock-home">
      <h2>模擬考</h2>
      <p className="mock-rules">
        一份考卷 100 題、限時 {MOCK_MINUTES / 60} 小時，和正式考試一樣。作答中不顯示對錯，可以改答案、標記題目，交卷後才看分數。
        開始後計時不會暫停，關掉分頁也會繼續倒數；時間到自動交卷。
      </p>
      <p className="board-note">
        每份考卷只有第一次模擬考列入排行榜，建議選還沒刷過的考卷。{!user && '登入後成績才會列入排行榜。'}
        {syncError && <span className="sync error">　成績同步失敗，之後會自動重試。</span>}
      </p>

      <table className="mock-papers">
        <tbody>
          {index.papers.map((p) => {
            const done = byPaper.get(p.id) ?? []
            const first = done.find((r) => firsts.has(r.id))
            const s = first && score(first)
            return (
              <tr key={p.id}>
                <td>{paperLabel(p)}</td>
                <td className="mock-status">
                  {first ? (
                    <button className="link" onClick={() => onOpen(first.id)}>
                      {s ? `${s.score} 分` : '…'}
                      {done.length > 1 && `（考過 ${done.length} 次）`}
                    </button>
                  ) : (
                    <span className="muted">還沒考</span>
                  )}
                </td>
                <td>
                  <button className={first ? 'ghost small' : 'primary small'} onClick={() => onStart(p.id)}>
                    {first ? '再考一次' : '開始'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {records.length > 0 && (
        <>
          <h3>歷次成績</h3>
          <table className="board-table mock-history">
            <thead>
              <tr>
                <th>時間</th>
                <th>考卷</th>
                <th>分數</th>
                <th>用時</th>
              </tr>
            </thead>
            <tbody>
              {[...records].reverse().map((r) => {
                const p = index.papers.find((x) => x.id === r.paper_id)
                const s = score(r)
                return (
                  <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                    <td>{dateTime(r.started_at)}</td>
                    <td>
                      {p ? paperLabel(p) : r.paper_id}
                      {!firsts.has(r.id) && <span className="pending">重考，不列入排行榜</span>}
                    </td>
                    <td>{s ? s.score : '…'}</td>
                    <td>{duration(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}

// ---------- 作答中 ----------

export function MockRunner(props: {
  session: MockSession
  label: string
  questions: Question[] // 依題號排好的可作答題目
  onChange: (s: MockSession) => void
  onSubmit: () => void
}) {
  const { session, label, questions, onChange, onSubmit } = props
  const [now, setNow] = useState(() => Date.now())
  const submitted = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const left = deadline(session.startedAt) - now
  const submit = () => {
    if (submitted.current) return
    submitted.current = true
    onSubmit()
  }

  // 時間到自動交卷（包含關掉分頁、時間過了才打開的情況）
  useEffect(() => {
    if (left <= 0) submit()
  })

  const pos = Math.min(session.pos, questions.length - 1)
  const q = questions[pos]
  const picked = q ? session.picks[q.id] : undefined
  const flagged = q ? session.flags.includes(q.id) : false
  const answered = questions.filter((x) => session.picks[x.id]).length

  const pick = (letter: Letter) => {
    if (!q) return
    const picks = { ...session.picks }
    if (picks[q.id] === letter) delete picks[q.id] // 再按一次同一個選項就取消
    else picks[q.id] = letter
    onChange({ ...session, picks })
  }
  const go = (i: number) => onChange({ ...session, pos: Math.max(0, Math.min(questions.length - 1, i)) })
  const toggleFlag = () => {
    if (!q) return
    onChange({ ...session, flags: flagged ? session.flags.filter((id) => id !== q.id) : [...session.flags, q.id] })
  }

  const confirmSubmit = () => {
    const blank = questions.length - answered
    const flags = session.flags.length
    const notes = [blank && `還有 ${blank} 題沒作答`, flags && `${flags} 題有標記`].filter(Boolean).join('、')
    if (window.confirm(`${notes ? notes + '。' : ''}確定要交卷嗎？交卷後就不能再改。`)) submit()
  }

  // 鍵盤：1–4 或 A–D 選答案（再按一次取消），←／→ 換題，Enter 下一題，F 標記
  const keyRef = useRef({ pick, go, toggleFlag, pos })
  keyRef.current = { pick, go, toggleFlag, pos }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('select, input, textarea')) return
      const k = e.key.toUpperCase()
      const n = '1234'.indexOf(k)
      const { pick, go, toggleFlag, pos } = keyRef.current
      if (n >= 0) pick(LETTERS[n])
      else if (LETTERS.includes(k as Letter)) pick(k as Letter)
      else if (k === 'ARROWRIGHT' || k === 'ENTER') go(pos + 1)
      else if (k === 'ARROWLEFT') go(pos - 1)
      else if (k === 'F') toggleFlag()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!q) return <div className="center">這份考卷沒有可作答的題目</div>

  return (
    <>
      <div className="mock-bar">
        <span className="mock-title">{label}</span>
        <span className={left < LOW_TIME_MS ? 'clock low' : 'clock'} role="timer" aria-label="剩餘時間">
          {formatClock(left)}
        </span>
        <span className="mock-count">
          已答 {answered} / {questions.length}
        </span>
        <button className="primary small" onClick={confirmSubmit}>
          交卷
        </button>
      </div>

      <main className="card">
        <div className="qhead">
          <span className="qnum">第 {q.number} 題</span>
          {flagged && <span className="tag warn">已標記</span>}
        </div>
        <p className="stem">{q.stem}</p>
        {q.images.map((src) => (
          <img key={src} className="figure" src={imageUrl(src)} alt={`第 ${q.number} 題附圖`} />
        ))}
        <ol className="options">
          {q.options.map((text, i) => (
            <li key={LETTERS[i]}>
              <button
                className={picked === LETTERS[i] ? 'option is-picked' : 'option'}
                aria-pressed={picked === LETTERS[i]}
                onClick={() => pick(LETTERS[i])}
              >
                <span className="key">{LETTERS[i]}</span>
                <span className="text">{text}</span>
              </button>
            </li>
          ))}
        </ol>
        <nav className="nav">
          <button className="ghost" onClick={() => go(pos - 1)} disabled={pos === 0}>
            ← 上一題
          </button>
          <button className={flagged ? 'ghost flag on' : 'ghost flag'} onClick={toggleFlag} aria-pressed={flagged}>
            {flagged ? '取消標記' : '標記'}
          </button>
          <button className="primary" onClick={() => go(pos + 1)} disabled={pos === questions.length - 1}>
            下一題 →
          </button>
        </nav>
        <p className="hint">鍵盤：1–4 選答案（再按一次取消），←／→ 換題，F 標記</p>
      </main>

      <section className="mock-grid" aria-label="題目總覽">
        {questions.map((x, i) => {
          const cls = ['cell', session.picks[x.id] && 'answered', session.flags.includes(x.id) && 'flagged', i === pos && 'current']
          return (
            <button key={x.id} className={cls.filter(Boolean).join(' ')} onClick={() => go(i)} aria-label={`第 ${x.number} 題`}>
              {x.number}
            </button>
          )
        })}
      </section>
      <p className="mock-legend">
        <span className="cell answered" /> 已作答　<span className="cell flagged" /> 已標記　<span className="cell" /> 未作答
      </p>
    </>
  )
}

// ---------- 交卷後 ----------

export function MockResult(props: {
  record: MockRecord
  label: string
  questions: Question[] // 這份考卷的全部題目
  subjects: Record<string, string>
  counted: boolean // 是否列入排行榜（每份考卷的第一次）
  user: User | null
  stage: Reaction | null
  onReview: (onlyWrong: boolean) => void
  onBack: () => void
}) {
  const { record, label, questions, subjects, counted, user, stage, onReview, onBack } = props
  const s = scoreMock(questions, record.picks)
  const wrong = questions.filter((q) => q.valid && !isMockCorrect(q, record.picks[q.id])).length

  return (
    <div className={stage ? 'play has-stage' : 'play'}>
      {stage && <CharacterStage reaction={stage} answered={false} />}
      <main className="card summary mock-result">
        <h2>{label}・模擬考成績</h2>
        <p className="score">
          <strong>{s.score}</strong> / {s.total}
        </p>
        <p className="score-meta">
          用時 {duration(record)}・作答 {s.answered} 題・
          {s.score >= PASS_SCORE ? `達到 ${PASS_SCORE} 分` : `離 ${PASS_SCORE} 分還差 ${PASS_SCORE - s.score} 分`}
          <span className="muted">（正式考試是兩科平均 {PASS_SCORE} 分及格）</span>
        </p>
        <p className="board-note">
          {!counted
            ? '這份考卷之前考過，這次不列入排行榜。'
            : tooQuick(record)
              ? `作答不到 ${MIN_RANKED_MINUTES} 分鐘就交卷，這份考卷不列入排行榜。`
              : user
                ? `${dateTime(record.started_at)} 開始，成績列入排行榜。`
                : '登入後這次成績會列入排行榜。'}
        </p>
        <table>
          <thead>
            <tr>
              <th>學科</th>
              <th>得分</th>
              <th>正確率</th>
            </tr>
          </thead>
          <tbody>
            {[...s.bySubject].map(([key, r]) => (
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
          <button className="ghost" onClick={onBack}>
            回到模擬考
          </button>
          <span className="nav-group">
            <button className="ghost" onClick={() => onReview(false)}>
              檢討全部
            </button>
            <button className="primary" onClick={() => onReview(true)} disabled={wrong === 0}>
              檢討錯題（{wrong}）
            </button>
          </span>
        </nav>
      </main>
    </div>
  )
}
