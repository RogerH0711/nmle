import { useState } from 'react'
import { PORTRAIT_WIDTH, portraitUrl, type Character, type Reaction } from './characters'

// 載入失敗的立繪網址：立繪還沒做好時不要每次都重抓
const missing = new Set<string>()

// 小框只顯示胸像：圖片依 bust 放大、平移，外框裁掉其餘部分。電腦版的大立繪由 CSS 改回全身。
function bustStyle(bust: Character['bust']) {
  if (!bust) return undefined
  return {
    '--bx': bust.x / PORTRAIT_WIDTH,
    '--by': bust.y / PORTRAIT_WIDTH,
    '--bw': bust.w / PORTRAIT_WIDTH,
  } as React.CSSProperties
}

export function Portrait({ character, expression }: { character: Character; expression: string }) {
  const [, rerender] = useState(0)
  const { id, name, color, bust } = character
  const candidates = [portraitUrl(id, expression), portraitUrl(id, 'normal')]
  const src = candidates.find((u) => !missing.has(u))

  if (!src) {
    return (
      <div className="portrait placeholder" style={{ background: color }} aria-label={`${name}（立繪準備中）`}>
        <span className="initial">{name.slice(-1)}</span>
        <span className="soon">立繪準備中</span>
      </div>
    )
  }
  return (
    <div className="portrait" style={bustStyle(bust)}>
      <img
        src={src}
        alt={name}
        onError={() => {
          missing.add(src)
          rerender((n) => n + 1)
        }}
      />
    </div>
  )
}

// answered：已經對這題作答。手機版這時把台詞移到選項下方（見 App 的 QuestionCard），上方只留立繪表情
export function CharacterStage({ reaction, answered }: { reaction: Reaction; answered: boolean }) {
  const { character, expression, text } = reaction
  return (
    <aside className={answered ? 'stage answered' : 'stage'} style={{ '--char': character.color } as React.CSSProperties}>
      <Portrait character={character} expression={expression} />
      <div className="speech">
        <div className="speaker">
          {character.name}
          <span className="speaker-title">{character.title}</span>
        </div>
        {text ? <p className="speech-text">{text}</p> : <p className="speech-text quiet">……</p>}
      </div>
    </aside>
  )
}
