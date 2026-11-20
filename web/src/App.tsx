import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ExamFile, Index, Letter, Question } from './types'
import { dataUrl, loadIndex, loadPaper, loadQuestions, paperLabel, paperOf } from './bank'
import { useSubtopics } from './subtopics'
import { recordAnswer, recordAnswers, switchUser, useAnswers } from './answers'
import { localDate, reviewStates, reviewSummary } from './review'
import { getDisplayName, setDisplayName, supabase } from './supabase'
import { LoginDialog } from './LoginDialog'
import { Leaderboard } from './Leaderboard'
import {
  characterForSubject, COMEBACK_DAYS, fillAway, fillPlayer, loadCharacters, loadLines, pickLine as pickCharacterLine,
  STREAK_EVERY, type Character, type Line, type Reaction, type Situation,
} from './characters'
import { CharacterStage } from './CharacterStage'
import { bestCharacter, firstAttempts, isMockCorrect, MOCK_HIGH, MOCK_MINUTES, mockQueue, scoreMock, submitTime, type MockSession } from './mock'
import { addMock, loadSession, saveSession, switchMockUser, useMocks } from './mockStore'
import { MockHome, MockResult, MockRunner } from './MockExam'
import { affection as affectionOf, rival as rivalOf, STAGE_NAMES, subjectMap, type Affection } from './affection'
import { loadSeen, loadStory, saveSeen, sceneId, unseenScene, type Scene } from './stories'
import { StoryList, StoryPlayer } from './Story'
import { DevPanel } from './DevPanel'
import { CampusMap } from './CampusMap'
import { StatusPanel } from './StatusPanel'
import { Guide, guideSeen } from './Guide'
import { TitleScreen, titleSeen } from './TitleScreen'
import { DEFAULT_PLAYER, loadPlayer, savePlayer, type PlayerTitle } from './player'
import { PlayerChoice } from './PlayerChoice'
import { fillVars, loadMessages, MESSAGE_SITUATION, messageEvents, saveMessages, type Message } from './messages'
import { MessageCenter, MessageToast } from './MessageCenter'
import { reportUsage } from './usage'
import { balance as balanceOf, earnings as earningsOf, giftPoints, isLiked, pickGiftLine, type Gift, type GiftCatalog } from './shop'
import { addGift, loadGifts, switchGiftUser, useGifts } from './giftStore'
import { fillGiftLine, GiftShop } from './GiftShop'
import { loadOutfits, pickOutfitLine, switchOutfitUser, useOutfits, wear, type Outfit } from './outfits'
import { playVoice, setBgm, sfx } from './audio'
import { chooseBgm, giftVoiceId } from './audioRules'
import { SoundSettings } from './SoundSettings'
import { QuestionBank } from './QuestionBank'
import { parseBankHash, type BankRoute } from './search'
import { toOriginal, type Order as OptionOrder } from './options'
import { useBack } from './backStack'
import { switchMarksUser, updateMark, useMarks } from './marksStore'
import { listOf } from './marks'
import { Library, LIST_LABEL, type ListKind } from './Library'
import { isCorrect, loadRun, paperQueue, pickRound, runStats, saveRun, shuffle, subjectQuestionIds, withOrders, wrongIds, type Order, type Run } from './run'
import { Account } from './AccountMenu'
import { Disclaimer } from './Disclaimer'
import { QuestionCard } from './QuestionCard'
import { Summary } from './Summary'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

const CHARACTER_MODE_KEY = 'nmle.characterMode'
const SHUFFLE_KEY = 'nmle.shuffleOptions'
const IDENTITY: OptionOrder = [0, 1, 2, 3]
const ROUND_SIZE = 20 // 跟角色讀書一回合的題數

// 角色反應對應到哪個時間點：題目 id、回合開始（start）或回合結束（finish）
type StageReaction = Reaction & { key: string }

// fallback：還沒設定過時的預設值
function loadFlag(key: string, fallback = false) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // 存不了就只在這次瀏覽有效
  }
}

export default function App() {
  const [index, setIndex] = useState<Index | null>(null)
  const [questions, setQuestions] = useState<Map<string, Question>>(new Map())
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const answers = useAnswers()
  const { marks } = useMarks() // 收藏、不確定、筆記（marksStore.ts）
  const subtopicData = useSubtopics(dataUrl('subtopics.json')) // 次主題（subtopics.ts），還沒分類時是 null
  const [libraryOpen, setLibraryOpen] = useState(false) // 圖書館的三個清單（角色模式）
  const [characters, setCharacters] = useState<Character[]>([])
  const [lines, setLines] = useState<Record<string, Line[]>>({})
  const [characterMode, setCharacterMode] = useState(() => loadFlag(CHARACTER_MODE_KEY, true)) // 角色模式為主：第一次打開就是校園地圖
  const [shuffleOptions, setShuffleOptions] = useState(() => loadFlag(SHUFFLE_KEY, true)) // 選項打亂，預設開
  const [reaction, setReaction] = useState<StageReaction | null>(null)
  const [streak, setStreak] = useState(0)
  // 題庫畫面的起始條件：網址是 #/bank/... 就直接打開題庫（分享出去的搜尋結果、某一題）
  const [bankStart, setBankStart] = useState<BankRoute | null>(() => parseBankHash(window.location.hash))
  const [view, setView] = useState<'quiz' | 'leaderboard' | 'mock' | 'bank'>(() => (bankStart ? 'bank' : 'quiz'))
  const [displayName, setDisplayNameState] = useState<string | null>(null)
  const mocks = useMocks()
  const [session, setSession] = useState<MockSession | null>(() => loadSession())
  const [mockResultId, setMockResultId] = useState<string | null>(null) // 正在看哪一次模擬考的成績
  const [mockStage, setMockStage] = useState<StageReaction | null>(null) // 剛交卷、高分時角色的反應
  const [stories, setStories] = useState<Record<string, Scene[]>>({})
  const [seen, setSeen] = useState(() => loadSeen()) // 這台裝置看過的劇情
  const [story, setStory] = useState<{ character: Character; scene: Scene; afterwards?: () => void; dev?: boolean } | null>(null)
  const [storyList, setStoryList] = useState<Character | null>(null)
  const [statusOpen, setStatusOpen] = useState(false) // 狀態面板（能力值）
  const [titleOpen, setTitleOpen] = useState(() => !titleSeen() && !bankStart) // 開頭畫面（封面）：每次打開網站先顯示；從題庫網址進來的不擋
  const closeTitle = useCallback(() => setTitleOpen(false), [])
  const [guideOpen, setGuideOpen] = useState(() => !guideSeen() && !bankStart) // 使用說明：第一次打開網站時自動顯示
  const [loginOpen, setLoginOpen] = useState(false)
  const [player, setPlayer] = useState<PlayerTitle | null>(loadPlayer) // 學姊們叫你學弟還是學妹；null 是還沒選
  const [playerOpen, setPlayerOpen] = useState(false) // 從地圖下方打開「稱呼」
  const PLAYER = player ?? DEFAULT_PLAYER
  const [onMap, setOnMap] = useState(true) // 角色模式的首頁是校園地圖；開始讀書後切到題目畫面
  const [messages, setMessages] = useState<Message[]>(() => loadMessages()) // 學姊傳的訊息（存在這台裝置）
  const [messagesOpen, setMessagesOpen] = useState<string | null | false>(false) // false：關著；null：訊息列表；字串：那位學姊的對話
  const [toast, setToast] = useState<Message | null>(null) // 剛收到的訊息，在畫面下方通知
  const gifts = useGifts() // 送給學姊的禮物（giftStore.ts）
  const [catalog, setCatalog] = useState<GiftCatalog | null>(null) // 禮物清單（data/gifts.json）
  const [freeShop, setFreeShop] = useState(false) // 開發者面板的免費商店（只在 npm run dev）
  const outfits = useOutfits() // 服裝清單與換上的服裝（outfits.ts）
  const [shopOpen, setShopOpen] = useState(false)

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
        const scenes = await Promise.all(list.map((c) => loadStory(c.id)))
        setStories(Object.fromEntries(list.map((c, i) => [c.id, scenes[i]])))
      })
      .catch(() => setCharacters([]))
    void loadGifts().then(setCatalog)
    void loadOutfits()
  }, [])

  const toggleCharacterMode = () => {
    setCharacterMode((on) => {
      saveFlag(CHARACTER_MODE_KEY, !on)
      return !on
    })
    setOnMap(true)
  }

  // ---------- 好感度 ----------
  // 由作答紀錄、模擬考紀錄和送禮紀錄推算（見 affection.ts、shop.ts），只在角色模式算
  const subjects = useMemo(() => (index ? subjectMap(index.papers) : null), [index])
  const affections = useMemo(() => {
    const m = new Map<string, Affection>()
    if (!characterMode || !subjects) return m
    for (const c of characters) {
      const points = catalog ? giftPoints(catalog, gifts.records, c.id) : []
      m.set(c.id, affectionOf(c.subjects, answers.records, mocks.records, subjects, points))
    }
    return m
  }, [characterMode, subjects, characters, answers.records, mocks.records, catalog, gifts.records])
  const stageOf = (c: Character) => affections.get(c.id)?.stage ?? 0

  // rival：吃醋時代入的那位；question：剛作答那題的題幹加選項，知識台詞看它有沒有對到關鍵字；
  // awayMs：離上次作答多久，久沒上線的台詞代入 {hours}、{minutes}（lineRules.ts）
  const react = (character: Character, situation: Situation, key: string,
    { rival, question, awayMs }: { rival?: string; question?: string; awayMs?: number } = {}): StageReaction => {
    const line = pickCharacterLine(lines[character.id] ?? [], situation, stageOf(character), reaction?.lineId ?? null, question)
    const text = line ? fillPlayer(line.text, PLAYER).replaceAll('{rival}', rival ?? '別的學姊') : null
    return {
      key,
      character,
      expression: line?.expression ?? 'normal',
      text: text && awayMs !== undefined ? fillAway(text, awayMs) : text,
      lineId: line?.id ?? null,
    }
  }

  const closeStory = () => {
    if (!story) return
    if (story.dev) return setStory(null) // 開發者面板打開的，不記成看過
    const next = new Set(seen).add(sceneId(story.character.id, story.scene.stage))
    setSeen(next)
    saveSeen(next)
    setStory(null)
    story.afterwards?.()
  }

  const newScene = (c: Character) => unseenScene(c.id, stories[c.id] ?? [], stageOf(c), seen)

  // 登入狀態：切換本機紀錄的擁有者並同步。
  // supabase 文件提醒不要在 onAuthStateChange 裡直接呼叫其他 supabase API，所以延後執行。
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setTimeout(() => {
        void switchUser(session?.user.id ?? null)
        void switchMockUser(session?.user.id ?? null)
        void switchGiftUser(session?.user.id ?? null)
        void switchMarksUser(session?.user.id ?? null)
        switchOutfitUser(session?.user.id ?? null)
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
      setRun(withOrders({ ...next, queue: next.queue.filter((id) => map.get(id)?.valid) }, map))
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

  // 題庫的網址：網址列貼上新的 #/bank/... 就打開；離開題庫畫面時拿掉
  useEffect(() => {
    const onHash = () => {
      const r = parseBankHash(window.location.hash)
      if (!r) return
      setBankStart(r)
      setView('bank')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (view !== 'bank' && window.location.hash.startsWith('#/bank')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [view])

  // 題庫找到的題目拿來刷：照列出來的順序
  const practiceBank = (ids: string[], label: string) => {
    if (!index) return
    setStreak(0)
    setOnMap(false)
    setView('quiz')
    void startRun(index, { kind: 'bank', paperId: null, subject: label, order: 'seq', queue: ids, pos: 0, picks: {} })
  }

  const review = useMemo(() => reviewSummary(reviewStates(answers.records)), [answers.records])

  // ---------- 禮物 ----------
  // 書籤由作答紀錄推算，減掉送出去的禮物就是餘額（shop.ts）
  const earned = useMemo(() => earningsOf(answers.records), [answers.records])
  const wallet = useMemo(() => balanceOf(answers.records, gifts.records), [answers.records, gifts.records])

  const giveGift = (c: Character, g: Gift) => {
    const stage = stageOf(c)
    const line = catalog ? pickGiftLine(lines[c.id] ?? [], g.id, isLiked(catalog, c.id, g.id), stage) : null
    addGift({
      id: crypto.randomUUID(), character_id: c.id, gift_id: g.id, price: freeShop ? 0 : g.price, stage,
      line_id: line?.id ?? null, given_at: new Date().toISOString(),
    })
    sfx('gift')
    void playVoice(line ? giftVoiceId(line, g.id) : null, PLAYER)
    return { expression: line?.expression ?? 'happy', text: line ? fillGiftLine(line.text, g, PLAYER) : null }
  }

  // 買服裝送她：記在送禮紀錄（書籤照扣，不加好感度），並馬上換上
  const buyOutfit = (c: Character, o: Outfit) => {
    const stage = stageOf(c)
    const line = pickOutfitLine(lines[c.id] ?? [], o.id, stage)
    addGift({
      id: crypto.randomUUID(), character_id: c.id, gift_id: o.id, price: freeShop ? 0 : (o.price ?? 0), stage,
      line_id: line?.id ?? null, given_at: new Date().toISOString(),
    })
    wear(c.id, o.id)
    sfx('gift')
    void playVoice(line?.id ?? null, PLAYER)
    return { expression: line?.expression ?? 'happy', text: line ? fillPlayer(line.text, PLAYER) : null }
  }

  // 匿名使用統計（usage.ts）：打開網站、切換角色模式或登入時送一次
  useEffect(() => {
    reportUsage({ characterMode, signedIn: !!user })
  }, [characterMode, user])

  // ---------- 學姊傳訊息 ----------
  // 依作答紀錄判斷該不該傳（messages.ts），同一件事只傳一次。只在角色模式傳
  useEffect(() => {
    if (!characterMode || !characters.length || !subjects || !Object.keys(lines).length || !Object.keys(stories).length) return
    if (answers.status === 'syncing') return // 登入時等雲端的紀錄同步完，不然會誤判「久沒上線」
    const events = messageEvents({
      characters,
      records: answers.records,
      dueIds: review.due,
      subjects,
      newScenes: characters.flatMap((c) => {
        const scene = newScene(c)
        return scene ? [{ character: c.id, stage: scene.stage }] : []
      }),
      comebackDays: COMEBACK_DAYS,
    })
    const known = new Set(messages.map((m) => m.key))
    const fresh = events.flatMap((e): Message[] => {
      const c = characters.find((x) => x.id === e.character)
      const line = c && !known.has(e.key) ? pickCharacterLine(lines[c.id] ?? [], MESSAGE_SITUATION[e.kind], stageOf(c)) : null
      if (!c || !line) return []
      const text = fillVars(fillPlayer(line.text, PLAYER), e.vars)
      return [{ key: e.key, kind: e.kind, character: c.id, text, expression: line.expression, at: new Date().toISOString(), read: false }]
    })
    if (!fresh.length) return
    const next = [...messages, ...fresh]
    setMessages(next)
    saveMessages(next)
    setToast(fresh[fresh.length - 1])
    sfx('message')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterMode, characters, subjects, lines, stories, answers.status, answers.records, review.due, seen, affections, messages])

  const readThread = (characterId: string) => {
    if (!messages.some((m) => m.character === characterId && !m.read)) return
    const next = messages.map((m) => (m.character === characterId ? { ...m, read: true } : m))
    setMessages(next)
    saveMessages(next)
  }
  const done = run ? run.pos >= run.queue.length : false
  const current = run && !done ? questions.get(run.queue[run.pos]) : undefined
  const picked = current && run ? run.picks[current.id] : undefined
  // 這題畫面上的選項順序：關掉打亂、或回合裡沒有這題的順序（檢討模擬考）就是原順序
  const optionOrder = (current && shuffleOptions && run?.orders?.[current.id]) || IDENTITY

  // 重新整理後恢復角色回合時，補一句台詞，不然角色會一直是「……」直到作答
  useEffect(() => {
    if (reaction || !characterMode || run?.kind !== 'character') return
    const c = characters.find((x) => x.id === run.subject)
    if (!c || !lines[c.id]) return // 台詞還沒載入
    if (done) setReaction(react(c, 'finish', 'finish'))
    else if (current && !picked) setReaction(react(c, 'start', run.pos === 0 ? 'start' : current.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction, characterMode, run, characters, lines, done, current, picked])

  const stats = useMemo(() => runStats(run, questions), [run, questions])

  // 這題由哪位角色陪：角色回合固定是那位，其他回合看題目學科歸誰
  const stageCharacter = !characterMode
    ? undefined
    : run?.kind === 'character'
      ? characters.find((c) => c.id === run.subject)
      : characterForSubject(characters, current?.subject ?? null)

  // ---------- 手機版捲動 ----------
  // 手機畫面短，題目上方又有標題、錯題複習、角色卡，作答後的回饋和「下一題」常常在畫面外。
  // 作答後把它們捲進畫面；換題時捲回題目開頭；開始新的一回合時捲到題目。
  const playRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const revealRef = useRef(false) // 剛作答，等回饋畫出來再捲動
  const runQueue = run?.queue
  const runPos = run?.pos
  const seenQueue = useRef<string[] | undefined>(undefined)

  useEffect(() => {
    if (!revealRef.current) return
    revealRef.current = false
    navRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })

  useEffect(() => {
    const el = playRef.current
    if (!el || !runQueue) return
    const first = seenQueue.current === undefined // 剛打開網頁、恢復上次的回合：不要自己捲動
    const fresh = seenQueue.current !== runQueue // 開始了新的一回合
    seenQueue.current = runQueue
    if (first) return
    const top = el.getBoundingClientRect().top
    // 換題時題目開頭在畫面上方看不到，或新回合的題目在畫面下半部，才捲動
    if (top < 0 || (fresh && top > window.innerHeight * 0.4)) {
      window.scrollTo({ top: window.scrollY + top - 8 })
    }
  }, [runQueue, runPos])

  // shown：畫面上按的字母（鍵盤 1–4、A–D 也是），換回原本的字母再記錄
  const pick = useCallback(
    (shown: Letter) => {
      if (!run || !current || picked) return
      const letter = toOriginal(optionOrder, shown)
      const ok = isCorrect(current, letter)
      setRun({ ...run, picks: { ...run.picks, [current.id]: letter } })
      recordAnswer(current.id, letter, ok)
      // 不確定清單的題目再答一次就移出：答錯會進錯題複習，答對但還是沒把握就再按一次「加入不確定清單」
      if (marks[current.id]?.unsure) updateMark(current.id, { unsure: false })
      revealRef.current = true
      const nextStreak = ok ? streak + 1 : 0
      setStreak(nextStreak)
      const situation = !ok ? 'wrong' : nextStreak % STREAK_EVERY === 0 ? 'streak' : 'correct'
      sfx(situation)
      if (stageCharacter) {
        setReaction(react(stageCharacter, situation, current.id, { question: [current.stem, ...current.options].join('\n') }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, current, picked, optionOrder, streak, stageCharacter, lines, reaction, marks],
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
      const wrong = wrongIds(run, questions)
      const queue = order === 'random' ? shuffle(wrong) : wrong
      setRun(withOrders({ ...run, subject, order, queue, pos: 0, picks: {}, orders: undefined }, questions)) // 重做時選項重新打亂
    } else if (run.kind === 'review') {
      startReview()
    } else if (run.kind === 'list') {
      startList(run.subject as ListKind)
    } else if (run.kind === 'character') {
      const c = characters.find((x) => x.id === run.subject)
      if (c) startCharacterRun(c)
    } else if (run.paperId) {
      void openPaper(index, run.paperId, subject, order)
    }
  }

  const startReview = () => {
    if (!index || !review.due.length) return
    setStreak(0)
    setOnMap(false)
    void startRun(index, { kind: 'review', paperId: null, subject: 'all', order: 'seq', queue: review.due, pos: 0, picks: {} })
  }

  // 圖書館的清單：不確定、收藏（只算題庫裡有的考卷）
  const lists = useMemo(() => {
    const known = (id: string) => !!index?.papers.some((p) => id.startsWith(p.id + '_'))
    return { unsure: listOf(marks, 'unsure').filter(known), favorite: listOf(marks, 'favorite').filter(known) }
  }, [marks, index])

  const startList = (kind: ListKind) => {
    if (!index || !lists[kind].length) return
    setLibraryOpen(false)
    setStreak(0)
    setOnMap(false)
    setView('quiz')
    void startRun(index, { kind: 'list', paperId: null, subject: kind, order: 'random', queue: shuffle(lists[kind]), pos: 0, picks: {} })
  }

  // 跟角色讀書：有還沒看過的劇情就先播，看完再開始
  const startCharacterRun = (c: Character) => {
    const scene = newScene(c)
    if (scene) setStory({ character: c, scene, afterwards: () => void beginCharacterRun(c) })
    else void beginCharacterRun(c)
  }

  // 從她負責的學科（跨所有考卷）抽題，沒寫過的優先
  const beginCharacterRun = async (c: Character) => {
    if (!index) return
    try {
      // 先從學科區段抽題號，只載入抽到的考卷；多抽幾題，扣掉不能出題的（例如選項是圖的題目）
      const seen = new Set(answers.records.map((r) => r.question_id))
      const picked = pickRound(subjectQuestionIds(index.papers, c.subjects), seen, ROUND_SIZE + 5)
      const loaded = await loadQuestions(index, picked)
      const queue = picked.filter((id) => loaded.get(id)?.valid).slice(0, ROUND_SIZE)
      const last = answers.records.reduce((max, r) => (r.answered_at > max ? r.answered_at : max), '')
      const awayMs = last ? Date.now() - new Date(last).getTime() : 0
      const away = awayMs > COMEBACK_DAYS * 86_400_000
      // 吃醋：有吃醋台詞的角色，熟識之後，上次跟她讀書之後跑去讀別人的學科
      const jealous =
        !away && subjects && stageOf(c) >= 1 && (lines[c.id] ?? []).some((l) => l.situation === 'jealous')
          ? rivalOf(c, characters, answers.records, subjects)
          : undefined
      const rivalName = jealous && `${(index.subjects[jealous.subjects[0]] ?? '').replace(/學$/, '')}那位`
      setStreak(0)
      setReaction(react(c, away ? 'comeback' : jealous ? 'jealous' : 'start', 'start', { rival: rivalName || undefined, awayMs }))
      await startRun(index, {
        kind: 'character', paperId: null, subject: c.id, order: 'random', queue, pos: 0, picks: {}, affection: stageOf(c),
      })
      setOnMap(false)
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
    const c = characterMode && score >= MOCK_HIGH ? bestCharacter(qs, picks, characters) : undefined
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
      setOnMap(false) // 檢討模擬考直接看題目，不回地圖
    } catch {
      setError('考卷載入失敗')
    }
  }

  // ---------- 聲音（audio.ts） ----------
  // BGM 依目前的畫面切換；學姊說話時播她那句的語音（有的話）
  const bgm = chooseBgm({
    characterMode: characterMode && characters.length > 0,
    mockRunning: !!session,
    story: story ? { character: story.character.id, bgm: story.scene.bgm } : null,
    onMap: onMap || view !== 'quiz',
    runKind: run?.kind ?? null,
    runCharacter: run?.kind === 'character' ? run.subject : null,
  })
  useEffect(() => setBgm(bgm), [bgm])
  useEffect(() => {
    if (reaction?.lineId) void playVoice(reaction.lineId, PLAYER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction])
  useEffect(() => {
    if (mockStage?.lineId) void playVoice(mockStage.lineId, PLAYER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockStage])

  // 鍵盤：1–4 或 A–D 作答，Enter／→ 下一題，← 上一題
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 看排行榜、考模擬考、看劇情、看能力值、在校園地圖上時，不要對藏起來的題目作答
      if (titleOpen || view !== 'quiz' || session || story || storyList || statusOpen || shopOpen || guideOpen || loginOpen || libraryOpen || messagesOpen !== false || (characterMode && onMap && characters.length > 0)) return
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
  }, [pick, go, picked, view, session, story, storyList, statusOpen, shopOpen, guideOpen, loginOpen, libraryOpen, messagesOpen, characterMode, onMap, characters, titleOpen])

  // ---------- 返回鍵（backStack.ts） ----------
  // 每一層打開時佔一筆 history，手機按返回時關掉最上面那層，不會直接離開網站。
  // 順序就是疊起來的順序：同一次畫面更新裡同時打開的，寫在前面的先推（例如交卷時先是模擬考畫面、再是成績）
  useBack(characterMode && characters.length > 0 && !onMap, () => setOnMap(true)) // 角色模式的題目畫面 → 回地圖
  useBack(view !== 'quiz', () => setView('quiz'))
  useBack(view === 'mock' && !!mockResultId, () => setMockResultId(null))
  useBack(!!session, () => false) // 模擬考作答中：和正式考試一樣不能中途離開，要交卷
  useBack(!!storyList, () => setStoryList(null))
  useBack(statusOpen, () => setStatusOpen(false))
  useBack(libraryOpen, () => setLibraryOpen(false))
  useBack(shopOpen, () => setShopOpen(false))
  useBack(messagesOpen !== false, () => setMessagesOpen(false))
  useBack(guideOpen, () => setGuideOpen(false))
  useBack(loginOpen, () => setLoginOpen(false))
  useBack(playerOpen && !!player, () => setPlayerOpen(false)) // 第一次選稱呼是必選的，不能返回
  useBack(!!story, () => closeStory())

  // 開頭畫面蓋在最前面，題庫在後面照常載入（點開始時通常已經載好）
  if (titleOpen) return <TitleScreen onStart={closeTitle} />
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

  // 和她讀到一半：接著讀，不要重開一回合
  const studyWith = (c: Character) =>
    run.kind === 'character' && run.subject === c.id && !done && run.pos > 0 ? setOnMap(false) : startCharacterRun(c)

  // 角色模式的首頁：校園地圖
  // 看排行榜、模擬考、題庫時不算在地圖上（稱呼對話框和訊息通知只在地圖上跳出）
  const showMap = characterMode && characters.length > 0 && onMap && view === 'quiz'
  const today = localDate()
  const answeredToday = answers.records.filter((r) => localDate(new Date(r.answered_at)) === today).length
  // 地圖下方的「繼續」：上次寫到一半的回合
  const runPaper = index.papers.find((p) => p.id === run.paperId)
  const runLabel =
    run.kind === 'character' ? `和${runCharacter?.name ?? '角色'}讀書`
    : run.kind === 'review' ? '錯題複習'
    : run.kind === 'list' ? LIST_LABEL[run.subject as ListKind] ?? '清單'
    : run.kind === 'mock' ? '檢討模擬考'
    : run.kind === 'bank' ? `題庫：${run.subject}`
    : runPaper ? paperLabel(runPaper) : '刷題'
  const resumeLabel = !done && run.pos > 0 ? `${runLabel} ${run.pos + 1} / ${run.queue.length}` : null

  // 模擬考作答中：只留計時和題目，跟正式考試一樣不能中途去刷題或看排行榜
  if (session) {
    const p = index.papers.find((x) => x.id === session.paperId)
    const byId = new Map(paperQuestionsOf(session.paperId).map((q) => [q.id, q]))
    const qs = mockQueue([...byId.values()]).map((id) => byId.get(id)!)
    return (
      <div className="app">
        <header className="bar">
          <h1>醫師一階攻略</h1>
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
        <Disclaimer />
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
        <h1>醫師一階攻略</h1>
        <div className="bar-right">
          {characters.length > 0 && (
            <label className="toggle">
              <input type="checkbox" checked={characterMode} onChange={toggleCharacterMode} />
              角色模式
            </label>
          )}
          <button
            className={view === 'bank' ? 'primary small bank-button' : 'ghost small bank-button'}
            onClick={() => {
              setBankStart(null)
              setView(view === 'bank' ? 'quiz' : 'bank')
            }}
          >
            題庫
          </button>
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
          <SoundSettings />
          <button className="ghost small" onClick={() => setGuideOpen(true)}>
            說明
          </button>
          <Account
            user={user}
            displayName={displayName}
            onRename={renameTo}
            onLogin={() => setLoginOpen(true)}
            status={answers.status}
            pending={answers.records.filter((r) => !r.synced).length}
            storageFull={answers.storageFull}
            mergedFromAnon={answers.mergedFromAnon}
          />
        </div>
      </header>

      {view === 'leaderboard' ? (
        <Leaderboard user={user} index={index} onLogin={() => setLoginOpen(true)} onClose={() => setView('quiz')} />
      ) : view === 'mock' ? (
        mockView
      ) : view === 'bank' ? (
        <QuestionBank
          key={bankStart ? JSON.stringify(bankStart) : 'bank'}
          index={index}
          initial={bankStart ?? { scope: 'all', number: null, query: '', subject: 'all' }}
          subtopics={subtopicData}
          onPractice={practiceBank}
        />
      ) : (
        <>

      {showMap ? (
        <CampusMap
          characters={characters}
          subjects={index.subjects}
          affections={affections}
          hasNewScene={(c) => !!newScene(c)}
          hasStories={(c) => !!stories[c.id]?.length}
          roundSize={ROUND_SIZE}
          reviewDue={review.due.length}
          listCount={lists.unsure.length + lists.favorite.length}
          answeredToday={answeredToday}
          resume={resumeLabel}
          onStudy={studyWith}
          onStories={setStoryList}
          onReview={() => setLibraryOpen(true)}
          onFree={() => setOnMap(false)}
          onStatus={() => setStatusOpen(true)}
          balance={catalog?.gifts.length ? Math.max(0, wallet) : null}
          onShop={() => setShopOpen(true)}
          unreadMessages={messages.filter((m) => !m.read).length}
          onMessages={() => setMessagesOpen(null)}
          player={PLAYER}
          onPlayer={() => setPlayerOpen(true)}
        />
      ) : (
        <>
      {characterMode && characters.length > 0 && (
        <button className="ghost small back-to-map" onClick={() => setOnMap(true)}>
          ← 回地圖
        </button>
      )}

      {/* 角色模式的錯題複習在地圖的圖書館 */}
      {!characterMode && (
        <section className="review">
          <div>
            <strong>錯題複習</strong>
            <span className="review-stats">
              今天到期 {review.due.length} 題・等待中 {review.waiting}・已攻略 {review.done}
            </span>
          </div>
          <span className="review-actions">
            <button className="primary small" onClick={startReview} disabled={!review.due.length || run.kind === 'review'}>
              {run.kind === 'review' ? '複習中' : '開始複習'}
            </button>
            {(['unsure', 'favorite'] as const).map((k) => (
              <button key={k} className="ghost small" onClick={() => startList(k)} disabled={!lists[k].length}>
                {k === 'unsure' ? '不確定' : '收藏'} {lists[k].length}
              </button>
            ))}
          </span>
        </section>
      )}

      <div className="controls">
        <select
          aria-label="考卷"
          value={run.kind === 'paper' ? (run.paperId ?? '') : ''}
          onChange={(e) => void openPaper(index, e.target.value)}
        >
          {run.kind === 'review' && <option value="">（錯題複習）</option>}
          {run.kind === 'list' && <option value="">（{LIST_LABEL[run.subject as ListKind] ?? '清單'}）</option>}
          {run.kind === 'character' && <option value="">（和{runCharacter?.name ?? '角色'}讀書）</option>}
          {run.kind === 'mock' && <option value="">（檢討模擬考）</option>}
          {run.kind === 'bank' && <option value="">（題庫：{run.subject}）</option>}
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
        {run.kind !== 'mock' && (
          <label className="toggle" title="每次出題時選項順序不同，避免記住答案的位置。一題多解的題目維持原順序。">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={() => {
                saveFlag(SHUFFLE_KEY, !shuffleOptions)
                setShuffleOptions(!shuffleOptions)
              }}
            />
            打亂選項
          </label>
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

      <div className={stage ? 'play has-stage' : 'play'} ref={playRef}>
        {stage && <CharacterStage reaction={stage} answered={!done && !!picked && stage.text !== null} />}
        <div className="play-main">
          {done ? (
            <Summary
              run={run}
              questions={questions}
              subjects={index.subjects}
              onRestart={run.kind === 'paper' || run.kind === 'character' || run.kind === 'list' ? () => restart(run.subject, run.order) : undefined}
              restartLabel={run.kind === 'character' ? '再一回合' : run.kind === 'list' ? '再刷一次' : '重新開始'}
              onRetryWrong={() => restart(run.subject, run.order, true)}
              unlock={
                runCharacter && run.affection !== undefined && stageOf(runCharacter) > run.affection
                  ? {
                      text: `和${runCharacter.name}的好感度提升到「${STAGE_NAMES[stageOf(runCharacter)]}」！`,
                      onPlay: newScene(runCharacter)
                        ? () => setStory({ character: runCharacter, scene: newScene(runCharacter)! })
                        : undefined,
                    }
                  : undefined
              }
            />
          ) : current ? (
            <QuestionCard
              q={current}
              order={optionOrder}
              index={index}
              picked={picked}
              onPick={pick}
              onNext={() => go(1)}
              onPrev={run.pos > 0 ? () => go(-1) : undefined}
              seed={run.pos}
              showLine={!stage}
              speech={stage && stage.text && picked ? { name: stage.character.name, color: stage.character.color, text: stage.text } : null}
              navRef={navRef}
            />
          ) : (
            <div className="center">這個範圍沒有可作答的題目</div>
          )}
        </div>
      </div>
        </>
      )}
        </>
      )}
      <Disclaimer />
      {storyList && affections.get(storyList.id) && (
        <StoryList
          character={storyList}
          scenes={stories[storyList.id] ?? []}
          affection={affections.get(storyList.id)!}
          seen={seen}
          onPlay={(scene) => {
            setStoryList(null)
            setStory({ character: storyList, scene })
          }}
          onClose={() => setStoryList(null)}
        />
      )}
      {/* 第一次進角色模式：看完說明後問稱呼，選了才繼續 */}
      {(playerOpen || (showMap && !player && !guideOpen && !story)) && (
        <PlayerChoice
          current={player}
          onPick={(t) => {
            savePlayer(t)
            setPlayer(t)
            setPlayerOpen(false)
          }}
          onClose={player ? () => setPlayerOpen(false) : undefined}
        />
      )}
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
      {guideOpen && (
        <Guide characters={characters} subjects={index.subjects} roundSize={ROUND_SIZE} onClose={() => setGuideOpen(false)} />
      )}
      {libraryOpen && (
        <Library
          review={{ due: review.due.length, waiting: review.waiting, done: review.done }}
          unsure={lists.unsure.length}
          favorite={lists.favorite.length}
          onReview={() => {
            setLibraryOpen(false)
            startReview()
          }}
          onList={startList}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {statusOpen && subjects && (
        <StatusPanel
          characters={characters}
          subjectNames={index.subjects}
          records={answers.records}
          map={subjects}
          onStudy={studyWith}
          subtopics={subtopicData}
          onPractice={practiceBank}
          onClose={() => setStatusOpen(false)}
        />
      )}
      {shopOpen && catalog && (
        <GiftShop
          characters={characters}
          catalog={catalog}
          outfits={outfits.catalog}
          lines={lines}
          affections={affections}
          gifts={gifts.records}
          seen={seen}
          balance={wallet}
          earnings={earned}
          player={PLAYER}
          free={import.meta.env.DEV && freeShop}
          onGive={giveGift}
          onBuyOutfit={buyOutfit}
          hasNewScene={(c) => !!newScene(c)}
          onStory={(c) => {
            const scene = newScene(c)
            if (!scene) return
            setShopOpen(false)
            setStory({ character: c, scene })
          }}
          onClose={() => setShopOpen(false)}
        />
      )}
      {messagesOpen !== false && (
        <MessageCenter
          messages={messages}
          characters={characters}
          initial={messagesOpen}
          onRead={readThread}
          onAction={(m) => {
            setMessagesOpen(false)
            const c = characters.find((x) => x.id === m.character)
            if (m.kind === 'review') startReview()
            else if (c) studyWith(c)
          }}
          onClose={() => setMessagesOpen(false)}
        />
      )}
      {/* 新訊息的通知：只在地圖上、沒有其他視窗時跳出 */}
      {toast && showMap && !story && !storyList && !guideOpen && !statusOpen && !shopOpen && messagesOpen === false && player && (() => {
        const c = characters.find((x) => x.id === toast.character)
        return c ? (
          <MessageToast
            message={toast}
            character={c}
            onOpen={() => {
              setToast(null)
              setMessagesOpen(c.id)
            }}
            onDismiss={() => setToast(null)}
          />
        ) : null
      })()}
      {import.meta.env.DEV && (
        <DevPanel
          characters={characters}
          stories={stories}
          onPlay={(character, scene) => setStory({ character, scene, dev: true })}
          freeShop={freeShop}
          onFreeShop={setFreeShop}
          onOpenShop={catalog && characterMode ? () => setShopOpen(true) : undefined} // 商店要在角色模式才算得出好感度
        />
      )}
      {story && <StoryPlayer key={sceneId(story.character.id, story.scene.stage)} character={story.character} scene={story.scene} player={PLAYER} affection={affections.get(story.character.id)} onClose={closeStory} />}
    </div>
  )
}
