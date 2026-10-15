import { useEffect, useState } from 'react'
import { fillPlayer, type Character } from './characters'
import { Portrait } from './CharacterStage'
import { STAGE_NAMES, type Affection } from './affection'
import { backgroundUrl, sceneId, type Scene } from './stories'

// 背景圖還沒做好時改用漸層色，載入失敗的不要每次重抓
const missingBg = new Set<string>()

/** 劇情播放：點一下（或 Enter、空白鍵）下一句，Esc 跳過 */
export function StoryPlayer(props: { character: Character; scene: Scene; player: string; onClose: () => void }) {
  const { character, scene, player, onClose } = props
  const [pos, setPos] = useState(0)
  const [, rerender] = useState(0)
  const line = scene.lines[pos]
  const last = pos >= scene.lines.length - 1

  // 旁白和玩家說話時，角色維持上一個表情
  const expression =
    scene.lines
      .slice(0, pos + 1)
      .reverse()
      .find((l) => l.speaker === character.id && l.expression)?.expression ?? 'normal'
  const shown = scene.lines.slice(0, pos + 1).some((l) => l.speaker === character.id)

  const next = () => (last ? onClose() : setPos(pos + 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setPos(Math.max(0, pos - 1))
      else if (e.key === 'Escape') onClose()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true) // 搶在作答的快捷鍵之前
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const bg = backgroundUrl(scene.background)
  const speaker =
    line.speaker === character.id ? character.name : line.speaker === 'player' ? '我' : null

  return (
    <div
      className={`story bg-${scene.background}`}
      style={{ '--char': character.color } as React.CSSProperties}
      role="dialog"
      aria-label={`${character.name}・${scene.title}`}
      onClick={next}
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
        <button
          className="ghost small"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          跳過
        </button>
      </div>
      <div className={shown ? 'story-figure' : 'story-figure hidden'}>
        <Portrait character={character} expression={expression} />
      </div>
      <div className={line.speaker === 'narration' ? 'story-box narration' : 'story-box'}>
        {speaker && <div className={line.speaker === 'player' ? 'story-speaker player' : 'story-speaker'}>{speaker}</div>}
        <p>{fillPlayer(line.text, player)}</p>
        <span className="story-more" aria-hidden>
          {last ? '結束' : '▼'}
        </span>
      </div>
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

/** 角色卡上的好感度：愛心表示階段，下一階的進度條 */
export function AffectionMeter({ affection }: { affection: Affection }) {
  const { stage, next } = affection
  const ratio = next ? Math.min(1, next.current / next.target) : 1
  return (
    <div className="affection" title={next ? `下一階：${next.label} ${next.current} / ${next.target} ${next.unit}` : undefined}>
      <span className="hearts" aria-label={`好感度：${STAGE_NAMES[stage]}`}>
        {Array.from({ length: STAGE_NAMES.length - 1 }, (_, i) => (i < stage ? '♥' : '♡')).join('')}
      </span>
      <span className="affection-name">{STAGE_NAMES[stage]}</span>
      {next && (
        <span className="affection-bar" aria-hidden>
          <span style={{ width: `${ratio * 100}%` }} />
        </span>
      )}
    </div>
  )
}
