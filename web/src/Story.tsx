import { useEffect, useState } from 'react'
import { fillPlayer, type Character } from './characters'
import { Portrait } from './CharacterStage'
import { STAGE_NAMES, type Affection } from './affection'
import { backgroundUrl, sceneId, storyTimeline, type Scene, type StoryLine } from './stories'

// 背景圖還沒做好時改用漸層色，載入失敗的不要每次重抓
const missingBg = new Set<string>()

// 自動播放：每句停留的時間，依字數加長；快轉固定很短
const autoDelay = (text: string) => 1500 + text.length * 70
const FAST_DELAY = 250

type Mode = 'manual' | 'auto' | 'fast'

/**
 * 劇情播放：點一下（或 Enter、空白鍵）下一句，← 上一句，Esc 跳過。
 * 控制列有自動、快轉、紀錄（回看前面的台詞）。不需要存檔、讀檔：看過的劇情隨時可以從「劇情」清單重看。
 */
export function StoryPlayer(props: {
  character: Character
  scene: Scene
  player: string
  affection?: Affection
  onClose: () => void
}) {
  const { character, scene, player, affection, onClose } = props
  const [picks, setPicks] = useState<number[]>([]) // 依序選了哪個選項
  const [pos, setPos] = useState(0)
  const [mode, setMode] = useState<Mode>('manual')
  const [backlog, setBacklog] = useState(false)
  const [, rerender] = useState(0)

  const timeline = storyTimeline(scene.lines, picks)
  const line = timeline[pos]
  const choosing = line.speaker === 'choice'
  const last = !choosing && pos >= timeline.length - 1
  const shownLines = timeline.slice(0, pos + 1)

  // 旁白和玩家說話時，角色維持上一個表情；角色第一次說話前不顯示立繪
  const expression = [...shownLines].reverse().find((l) => l.speaker === character.id && l.expression)?.expression ?? 'normal'
  const shown = shownLines.some((l) => l.speaker === character.id)

  const next = () => {
    if (choosing || backlog) return
    if (last) onClose()
    else setPos(pos + 1)
  }

  const choose = (i: number) => {
    setPicks([...picks, i])
    setPos(pos + 1) // 跳過「玩家說出選項」那一句（剛點過），直接看她的回應
  }

  // 自動、快轉：遇到選項或最後一句就停下來
  useEffect(() => {
    if (mode === 'manual' || backlog || choosing) return
    if (last) {
      setMode('manual')
      return
    }
    const t = setTimeout(() => setPos((p) => p + 1), mode === 'fast' ? FAST_DELAY : autoDelay(line.text ?? ''))
    return () => clearTimeout(t)
  }, [mode, backlog, choosing, last, pos, line])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (backlog) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') setBacklog(false)
        else return
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setPos(Math.max(0, pos - 1))
      else if (e.key === 'Escape') onClose()
      else if (choosing && '123'.includes(e.key) && line.options?.[Number(e.key) - 1]) choose(Number(e.key) - 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true) // 搶在作答的快捷鍵之前
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const bg = backgroundUrl(scene.background)
  const nameOf = (l: StoryLine) => (l.speaker === character.id ? character.name : l.speaker === 'player' ? '我' : null)
  // 選項出現時，對話框留著上一句台詞
  const textLine = choosing ? [...shownLines].reverse().find((l) => l.speaker !== 'choice') : line
  const speaker = textLine && nameOf(textLine)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const toggle = (m: Mode) => setMode(mode === m ? 'manual' : m)

  return (
    <div
      className={`story bg-${scene.background}`}
      style={{ '--char': character.color } as React.CSSProperties}
      role="dialog"
      aria-label={`${character.name}・${scene.title}`}
      onClick={() => (mode === 'manual' ? next() : setMode('manual'))}
    >
      {!missingBg.has(bg) && (
        <img
          className="story-bg"
          src={bg}
          alt=""
          onError={() => {
            missingBg.add(bg)
            rerender((n) => n + 1)
          }}
        />
      )}
      <div className="story-head">
        <span className="story-title">
          {character.name}・{STAGE_NAMES[scene.stage]}
        </span>
        {affection && (
          <span className="story-heart" title={`好感度：${STAGE_NAMES[affection.stage]}`}>
            <span className="hearts">
              {Array.from({ length: STAGE_NAMES.length - 1 }, (_, i) => (i < affection.stage ? '♥' : '♡')).join('')}
            </span>
            {STAGE_NAMES[affection.stage]}
          </span>
        )}
      </div>
      <div className={shown ? 'story-figure' : 'story-figure hidden'}>
        <Portrait character={character} expression={expression} />
      </div>

      {choosing && (
        <div className="story-choices" onClick={stop}>
          {line.options?.map((o, i) => (
            <button key={i} onClick={() => choose(i)}>
              {fillPlayer(o.text, player)}
            </button>
          ))}
        </div>
      )}

      <div className="story-bottom">
        {speaker && <div className={textLine?.speaker === 'player' ? 'story-name player' : 'story-name'}>{speaker}</div>}
        <div className={textLine?.speaker === 'narration' ? 'story-box narration' : 'story-box'}>
          <p>{fillPlayer(textLine?.text ?? '', player)}</p>
          {!choosing && (
            <span className="story-more" aria-hidden>
              {last ? '結束' : '▼'}
            </span>
          )}
        </div>
        <nav className="story-controls" onClick={stop}>
          <button className={mode === 'auto' ? 'on' : ''} onClick={() => toggle('auto')} aria-pressed={mode === 'auto'}>
            自動
          </button>
          <button className={mode === 'fast' ? 'on' : ''} onClick={() => toggle('fast')} aria-pressed={mode === 'fast'}>
            快轉
          </button>
          <button onClick={() => setBacklog(true)}>紀錄</button>
          <button onClick={onClose}>跳過</button>
        </nav>
      </div>

      {backlog && (
        <div className="story-backlog" onClick={(e) => {
            stop(e)
            setBacklog(false)
          }}>
          <h2>紀錄</h2>
          <ol>
            {shownLines
              .filter((l) => l.speaker !== 'choice')
              .map((l, i) => (
                <li key={i} className={l.speaker === 'narration' ? 'narration' : ''}>
                  {nameOf(l) && <strong className={l.speaker === 'player' ? 'player' : ''}>{nameOf(l)}</strong>}
                  <span>{fillPlayer(l.text ?? '', player)}</span>
                </li>
              ))}
          </ol>
          <p className="story-backlog-hint">點一下回到劇情</p>
        </div>
      )}
    </div>
  )
}


/** 角色的劇情清單：已解鎖的可以重看，沒解鎖的顯示條件 */
export function StoryList(props: {
  character: Character
  scenes: Scene[]
  affection: Affection
  seen: Set<string>
  onPlay: (scene: Scene) => void
  onClose: () => void
}) {
  const { character, scenes, affection, seen, onPlay, onClose } = props
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal story-list"
        style={{ '--char': character.color } as React.CSSProperties}
        role="dialog"
        aria-label={`${character.name}的劇情`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{character.name}的劇情</h2>
        <ol>
          {STAGE_NAMES.map((name, stage) => {
            const scene = scenes.find((s) => s.stage === stage)
            const open = scene && stage <= affection.stage
            return (
              <li key={stage} className={open ? '' : 'locked'}>
                <span className="story-stage">{name}</span>
                {open ? (
                  <button className="link" onClick={() => onPlay(scene)}>
                    {seen.has(sceneId(character.id, stage)) ? '重看' : '新劇情！'}
                  </button>
                ) : (
                  <span className="story-lock">
                    {stage === affection.stage + 1 && affection.next
                      ? `${affection.next.label} ${affection.next.current} / ${affection.next.target} ${affection.next.unit}`
                      : stage === STAGE_NAMES.length - 1
                        ? '考完一階後解鎖'
                        : '尚未解鎖'}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        <button className="primary small" onClick={onClose}>
          關閉
        </button>
      </div>
    </div>
  )
}

/** 好感度：愛心表示階段，下一階的進度條（校園地圖的地點上用）。外層是 span，才能放在按鈕裡 */
export function AffectionMeter({ affection }: { affection: Affection }) {
  const { stage, next } = affection
  const ratio = next ? Math.min(1, next.current / next.target) : 1
  return (
    <span className="affection" title={next ? `下一階：${next.label} ${next.current} / ${next.target} ${next.unit}` : undefined}>
      <span className="hearts" aria-label={`好感度：${STAGE_NAMES[stage]}`}>
        {Array.from({ length: STAGE_NAMES.length - 1 }, (_, i) => (i < stage ? '♥' : '♡')).join('')}
      </span>
      <span className="affection-name">{STAGE_NAMES[stage]}</span>
      {next && (
        <span className="affection-bar" aria-hidden>
          <span style={{ width: `${ratio * 100}%` }} />
        </span>
      )}
    </span>
  )
}
