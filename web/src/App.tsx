import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ExamFile, Index, Letter, Question } from './types'
import { imageUrl, loadIndex, loadPaper, loadQuestions, paperLabel, paperOf } from './bank'
import { recordAnswer, recordAnswers, switchUser, syncNow, useAnswers, type SyncStatus } from './answers'
import { reviewStates, reviewSummary } from './review'
import { getDisplayName, NAME_MAX, setDisplayName, signInWithGoogle, signOut, supabase } from './supabase'
import { Leaderboard } from './Leaderboard'
import {
  characterForSubject, COMEBACK_DAYS, fillPlayer, loadCharacters, loadLines, pickLine as pickCharacterLine,
  STREAK_EVERY, type Character, type Line, type Reaction, type Situation,
} from './characters'
import { CharacterStage, Portrait } from './CharacterStage'
import { firstAttempts, isMockCorrect, MOCK_HIGH, MOCK_MINUTES, mockQueue, scoreMock, submitTime, type MockSession } from './mock'
import { addMock, loadSession, saveSession, switchMockUser, useMocks } from './mockStore'
import { MockHome, MockResult, MockRunner } from './MockExam'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

type Order = 'seq' | 'random'

// 一回合：依考卷刷題（paper）、錯題複習（review）、跟角色讀書（character，subject 存角色 id）
// 或檢討模擬考（mock，picks 預先填入交卷時的答案）。
// 題目可以跨考卷，用題目 id 串起來。存在 localStorage，重新整理不會不見。
interface Run {
  kind: 'paper' | 'review' | 'character' | 'mock'
  paperId: string | null
  subject: string
  order: Order
  queue: string[]
  pos: number
  picks: Record<string, Letter>
}

const RUN_KEY = 'nmle.run.v2'
const CHARACTER_MODE_KEY = 'nmle.characterMode'
const ROUND_SIZE = 20 // 跟角色讀書一回合的題數

// 角色反應對應到哪個時間點：題目 id、回合開始（start）或回合結束（finish）
type StageReaction = Reaction & { key: string }

function loadFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

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

// 一般模式（或這個學科的角色還沒推出）用的通用回饋
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
  const [characters, setCharacters] = useState<Character[]>([])
  const [lines, setLines] = useState<Record<string, Line[]>>({})
  const [characterMode, setCharacterMode] = useState(() => loadFlag(CHARACTER_MODE_KEY))
  const [reaction, setReaction] = useState<StageReaction | null>(null)
  const [streak, setStreak] = useState(0)
  const [view, setView] = useState<'quiz' | 'leaderboard' | 'mock'>('quiz')
  const [displayName, setDisplayNameState] = useState<string | null>(null)
  const mocks = useMocks()
  const [session, setSession] = useState<MockSession | null>(() => loadSession())
  const [mockResultId, setMockResultId] = useState<string | null>(null) // 正在看哪一次模擬考的成績
  const [mockStage, setMockStage] = useState<StageReaction | null>(null) // 剛交卷、高分時角色的反應

  // 登入後讀自己的暱稱（排行榜上顯示的名字）
  useEffect(() => {
    setDisplayNameState(null)
    if (user) getDisplayName(user.id).then(setDisplayNameState).catch(() => setDisplayNameState(null))
  }, [user])

  const renameTo = async (name: string) => {
    if (!user) return
    await setDisplayName(user.id, name)
    setDisplayNameState(name)
  }

  // 角色和台詞都很小，一開始就全部載入，作答時才能同步挑台詞
  useEffect(() => {
    loadCharacters()
      .then(async (list) => {
        setCharacters(list)
        const all = await Promise.all(list.map((c) => loadLines(c.id)))
        setLines(Object.fromEntries(list.map((c, i) => [c.id, all[i]])))
      })
      .catch(() => setCharacters([]))
  }, [])

  const toggleCharacterMode = () => {
    setCharacterMode((on) => {
      saveFlag(CHARACTER_MODE_KEY, !on)
      return !on
    })
  }

  const react = (character: Character, situation: Situation, key: string): StageReaction => {
    const line = pickCharacterLine(lines[character.id] ?? [], situation, 0, reaction?.lineId ?? null)
    return {
      key,
      character,
      expression: line?.expression ?? 'normal',
      text: line ? fillPlayer(line.text, '學弟') : null,
      lineId: line?.id ?? null,
    }
  }

  // 登入狀態：切換本機紀錄的擁有者並同步。
  // supabase 文件提醒不要在 onAuthStateChange 裡直接呼叫其他 supabase API，所以延後執行。
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setTimeout(() => {
        void switchUser(session?.user.id ?? null)
        void switchMockUser(session?.user.id ?? null)
      }, 0)
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

  // 這題由哪位角色陪：角色回合固定是那位，其他回合看題目學科歸誰
  const stageCharacter = !characterMode
    ? undefined
    : run?.kind === 'character'
      ? characters.find((c) => c.id === run.subject)
      : characterForSubject(characters, current?.subject ?? null)

  const pick = useCallback(
    (letter: Letter) => {
      if (!run || !current || picked) return
      const ok = isCorrect(current, letter)
      setRun({ ...run, picks: { ...run.picks, [current.id]: letter } })
      recordAnswer(current.id, letter, ok)
      const nextStreak = ok ? streak + 1 : 0
      setStreak(nextStreak)
      if (stageCharacter) {
        const situation = !ok ? 'wrong' : nextStreak % STREAK_EVERY === 0 ? 'streak' : 'correct'
        setReaction(react(stageCharacter, situation, current.id))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, current, picked, streak, stageCharacter, lines, reaction],
  )

  const go = useCallback(
    (delta: number) => {
      if (!run) return
      const pos = Math.max(0, Math.min(run.queue.length, run.pos + delta))
      setRun({ ...run, pos })
      if (pos === run.queue.length && pos !== run.pos && stageCharacter && run.kind === 'character') {
        setReaction(react(stageCharacter, 'finish', 'finish'))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, stageCharacter, lines, reaction],
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
    } else if (run.kind === 'character') {
      const c = characters.find((x) => x.id === run.subject)
      if (c) void startCharacterRun(c)
    } else if (run.paperId) {
      void openPaper(index, run.paperId, subject, order)
    }
  }

  const startReview = () => {
    if (!index || !review.due.length) return
    setStreak(0)
    void startRun(index, { kind: 'review', paperId: null, subject: 'all', order: 'seq', queue: review.due, pos: 0, picks: {} })
  }

  // 跟角色讀書：從她負責的學科（跨所有考卷）抽題，沒寫過的優先
  const startCharacterRun = async (c: Character) => {
    if (!index) return
    try {
      const files = await Promise.all(index.papers.map((p) => loadPaper(index, p.id)))
      const pool = files.flatMap((f) => f.questions).filter((q) => q.valid && q.subject && c.subjects.includes(q.subject))
      const seen = new Set(answers.records.map((r) => r.question_id))
      const queue = [...shuffle(pool.filter((q) => !seen.has(q.id))), ...shuffle(pool.filter((q) => seen.has(q.id)))]
        .slice(0, ROUND_SIZE)
        .map((q) => q.id)
      const last = answers.records.reduce((max, r) => (r.answered_at > max ? r.answered_at : max), '')
      const away = last && Date.now() - new Date(last).getTime() > COMEBACK_DAYS * 86_400_000
      setStreak(0)
      setReaction(react(c, away ? 'comeback' : 'start', 'start'))
      await startRun(index, { kind: 'character', paperId: null, subject: c.id, order: 'random', queue, pos: 0, picks: {} })
    } catch {
      setError('題庫載入失敗')
    }
  }

  // ---------- 模擬考 ----------

  const mockRecord = mockResultId ? mocks.records.find((r) => r.id === mockResultId) : undefined
  const paperQuestionsOf = (paperId: string) => [...questions.values()].filter((q) => paperOf(q.id) === paperId)
  const mergePaper = (f: ExamFile) => setQuestions((prev) => new Map([...prev, ...f.questions.map((q) => [q.id, q] as const)]))

  // 作答中、或正在看成績的那份考卷要先載入
  const neededPaper = session?.paperId ?? mockRecord?.paper_id
  useEffect(() => {
    if (index && neededPaper) loadPaper(index, neededPaper).then(mergePaper).catch(() => setError('考卷載入失敗'))
  }, [index, neededPaper])

  const updateSession = (s: MockSession | null) => {
    setSession(s)
    saveSession(s)
  }

  const startMock = async (paperId: string) => {
    const p = index?.papers.find((x) => x.id === paperId)
    if (!index || !p) return
    const again = mocks.records.some((r) => r.paper_id === paperId)
    const message =
      `開始 ${paperLabel(p)} 模擬考？\n限時 ${MOCK_MINUTES / 60} 小時，開始後計時不會暫停，要交卷才會結束。` +
      (again ? '\n這份考卷之前考過，這次不會列入排行榜。' : '')
    if (!window.confirm(message)) return
    try {
      mergePaper(await loadPaper(index, paperId))
      setMockResultId(null)
      setMockStage(null)
      updateSession({ id: crypto.randomUUID(), paperId, startedAt: new Date().toISOString(), picks: {}, flags: [], pos: 0 })
    } catch {
      setError('考卷載入失敗')
    }
  }

  // 這份考卷題數最多的角色（高分時由她來說話）
  const mainCharacter = (qs: Question[]) => {
    const count = new Map<Character, number>()
    for (const q of qs) {
      const c = characterForSubject(characters, q.subject)
      if (c) count.set(c, (count.get(c) ?? 0) + 1)
    }
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
  }

  const submitMock = () => {
    if (!session) return
    const qs = paperQuestionsOf(session.paperId).filter((q) => q.valid)
    const submittedAt = submitTime(session.startedAt)
    const picks = Object.fromEntries(qs.filter((q) => session.picks[q.id]).map((q) => [q.id, session.picks[q.id]]))
    addMock({ id: session.id, paper_id: session.paperId, started_at: session.startedAt, submitted_at: submittedAt, picks })
    // 每題也寫進作答紀錄：答錯的進錯題複習，也算進週榜
    recordAnswers(
      qs.filter((q) => picks[q.id]).map((q) => ({ questionId: q.id, picked: picks[q.id], correct: isMockCorrect(q, picks[q.id]) })),
      submittedAt,
    )
    const { score } = scoreMock(paperQuestionsOf(session.paperId), picks)
    const c = characterMode && score >= MOCK_HIGH ? mainCharacter(qs) : undefined
    setMockStage(c ? react(c, 'mock_high', session.id) : null)
    updateSession(null)
    setMockResultId(session.id)
    setView('mock')
  }

  // 檢討：交卷時的答案預先填好，沒作答的題目可以當場作答
  const reviewMock = async (recordId: string, onlyWrong: boolean) => {
    const r = mocks.records.find((x) => x.id === recordId)
    if (!index || !r) return
    try {
      const f = await loadPaper(index, r.paper_id)
      const byId = new Map(f.questions.map((q) => [q.id, q]))
      const queue = mockQueue(f.questions).filter((id) => !onlyWrong || !isMockCorrect(byId.get(id)!, r.picks[id]))
      setStreak(0)
      await startRun(index, { kind: 'mock', paperId: r.paper_id, subject: 'all', order: 'seq', queue, pos: 0, picks: { ...r.picks } })
      setView('quiz')
    } catch {
      setError('考卷載入失敗')
    }
  }

  // 鍵盤：1–4 或 A–D 作答，Enter／→ 下一題，← 上一題
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== 'quiz' || session) return // 看排行榜、考模擬考時不要對藏起來的題目作答
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
  }, [pick, go, picked, view, session])

  if (error) return <div className="center">{error}</div>
  if (!index || !run) return <div className="center">載入中…</div>

  const paperQuestions = run.paperId ? [...questions.values()].filter((q) => q.id.startsWith(run.paperId + '_')) : []
  const subjectsInPaper = [...new Set(paperQuestions.map((q) => q.subject).filter(Boolean))] as string[]
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0

  // 要顯示的角色反應：符合目前這一刻的才用，否則角色安靜待著
  const stageKey = done ? 'finish' : !picked && run.pos === 0 && reaction?.key === 'start' ? 'start' : current?.id
  const stage: Reaction | null = stageCharacter
    ? reaction && reaction.key === stageKey && reaction.character.id === stageCharacter.id
      ? reaction
      : { character: stageCharacter, expression: 'normal', text: null, lineId: null }
    : null
  const runCharacter = run.kind === 'character' ? characters.find((c) => c.id === run.subject) : undefined

  // 模擬考作答中：只留計時和題目，跟正式考試一樣不能中途去刷題或看排行榜
  if (session) {
    const p = index.papers.find((x) => x.id === session.paperId)
    const byId = new Map(paperQuestionsOf(session.paperId).map((q) => [q.id, q]))
    const qs = mockQueue([...byId.values()]).map((id) => byId.get(id)!)
    return (
      <div className="app">
        <header className="bar">
          <h1>一階刷題</h1>
          <span className="tag warn">模擬考進行中</span>
        </header>
        {qs.length ? (
          <MockRunner
            session={session}
            label={p ? paperLabel(p) : session.paperId}
            questions={qs}
            onChange={updateSession}
            onSubmit={submitMock}
          />
        ) : (
          <div className="center">載入中…</div>
        )}
      </div>
    )
  }

  const mockPaper = mockRecord && index.papers.find((x) => x.id === mockRecord.paper_id)
  const mockQuestions = mockRecord ? paperQuestionsOf(mockRecord.paper_id) : []
  const mockView = !mockRecord ? (
    <MockHome
      index={index}
      records={mocks.records}
      user={user}
      syncError={mocks.error}
      onStart={(id) => void startMock(id)}
      onOpen={(id) => {
        setMockStage(null)
        setMockResultId(id)
      }}
    />
  ) : mockQuestions.length ? (
    <MockResult
      record={mockRecord}
      label={mockPaper ? paperLabel(mockPaper) : mockRecord.paper_id}
      questions={mockQuestions}
      subjects={index.subjects}
      counted={firstAttempts(mocks.records).has(mockRecord.id)}
      user={user}
      stage={mockStage?.key === mockRecord.id ? mockStage : null}
      onReview={(onlyWrong) => void reviewMock(mockRecord.id, onlyWrong)}
      onBack={() => setMockResultId(null)}
    />
  ) : (
    <div className="center">載入中…</div>
  )

  return (
    <div className={stage ? 'app wide' : 'app'}>
      <header className="bar">
        <h1>一階刷題</h1>
        <div className="bar-right">
          {characters.length > 0 && (
            <label className="toggle">
              <input type="checkbox" checked={characterMode} onChange={toggleCharacterMode} />
              角色模式
            </label>
          )}
          <button
            className={view === 'mock' ? 'primary small' : 'ghost small'}
            onClick={() => {
              setView(view === 'mock' ? 'quiz' : 'mock')
              setMockResultId(null)
            }}
          >
            模擬考
          </button>
          <button
            className={view === 'leaderboard' ? 'primary small' : 'ghost small'}
            onClick={() => setView(view === 'leaderboard' ? 'quiz' : 'leaderboard')}
          >
            排行榜
          </button>
          <Account
            user={user}
            displayName={displayName}
            onRename={renameTo}
            status={answers.status}
            pending={answers.records.filter((r) => !r.synced).length}
          />
        </div>
      </header>

      {view === 'leaderboard' ? (
        <Leaderboard user={user} index={index} onClose={() => setView('quiz')} />
      ) : view === 'mock' ? (
        mockView
      ) : (
        <>

      {characterMode && characters.length > 0 && (
        <section className="cast">
          {characters.map((c) => (
            <div key={c.id} className="cast-card" style={{ '--char': c.color } as React.CSSProperties}>
              <Portrait character={c} expression="normal" />
              <div className="cast-info">
                <strong>{c.name}</strong>
                <span className="cast-type">{c.type}・{c.title}</span>
                <span className="cast-subjects">{c.subjects.map((s) => index.subjects[s] ?? s).join('、')}</span>
                <button className="primary small" onClick={() => void startCharacterRun(c)}>
                  一起讀書（{ROUND_SIZE} 題）
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

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
          {run.kind === 'character' && <option value="">（和{runCharacter?.name ?? '角色'}讀書）</option>}
          {run.kind === 'mock' && <option value="">（檢討模擬考）</option>}
          {index.papers.map((p) => (
            <option key={p.id} value={p.id}>
              {paperLabel(p)}
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

      <div className={stage ? 'play has-stage' : 'play'}>
        {stage && <CharacterStage reaction={stage} answered={!done && !!picked && stage.text !== null} />}
        <div className="play-main">
          {done ? (
            <Summary
              run={run}
              questions={questions}
              subjects={index.subjects}
              onRestart={run.kind === 'paper' || run.kind === 'character' ? () => restart(run.subject, run.order) : undefined}
              restartLabel={run.kind === 'character' ? '再一回合' : '重新開始'}
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
              showLine={!stage}
              speech={stage && stage.text && picked ? { name: stage.character.name, color: stage.character.color, text: stage.text } : null}
            />
          ) : (
            <div className="center">這個範圍沒有可作答的題目</div>
          )}
        </div>
      </div>
        </>
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

function Account(props: {
  user: User | null
  displayName: string | null
  onRename: (name: string) => Promise<void>
  status: SyncStatus
  pending: number
}) {
  const { user, displayName, onRename, status, pending } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const save = async () => {
    const name = draft.trim()
    if (!name || name.length > NAME_MAX) {
      setRenameError(`暱稱要 1–${NAME_MAX} 個字`)
      return
    }
    setSaving(true)
    try {
      await onRename(name)
      setEditing(false)
      setRenameError(null)
    } catch {
      setRenameError('儲存失敗，再試一次')
    } finally {
      setSaving(false)
    }
  }

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
  if (editing) {
    return (
      <form
        className="account"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          className="name-input"
          value={draft}
          maxLength={NAME_MAX}
          autoFocus
          aria-label="暱稱"
          placeholder="排行榜上顯示的名字"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="primary small" type="submit" disabled={saving}>
          儲存
        </button>
        <button className="ghost small" type="button" onClick={() => setEditing(false)}>
          取消
        </button>
        {renameError && <span className="sync error">{renameError}</span>}
      </form>
    )
  }

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
      <button
        className="name link"
        title="修改暱稱（排行榜上顯示的名字）"
        onClick={() => {
          setDraft(displayName ?? '')
          setRenameError(null)
          setEditing(true)
        }}
      >
        {displayName ?? '…'} ✎
      </button>
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
  showLine: boolean // 有角色陪讀時，反應台詞由角色說，這裡只顯示正解
  speech: { name: string; color: string; text: string } | null // 手機版把角色台詞放在選項下方，作答後一眼看得到
}) {
  const { q, index, picked, onPick, onNext, onPrev, seed, showLine, speech } = props
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
          {showLine && <p className="line">{pickLine(correct ? 'correct' : 'wrong', seed)}</p>}
          {speech && (
            <p className="line char-line">
              <span style={{ color: speech.color }}>{speech.name}</span>：{speech.text}
            </p>
          )}
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
  restartLabel: string
  onRetryWrong: () => void
}) {
  const { run, questions, subjects, onRestart, restartLabel, onRetryWrong } = props
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
      <h2>{run.kind === 'review' ? '今天的複習完成了' : run.kind === 'mock' ? '檢討完成' : '這回合結束'}</h2>
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
            {restartLabel}
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
