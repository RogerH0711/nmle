import { useState } from 'react'
import { portraitUrl, type Reaction } from './characters'

// 載入失敗的立繪網址：立繪還沒做好時不要每次都重抓
const missing = new Set<string>()

export function Portrait({ characterId, expression, name, color }: { characterId: string; expression: string; name: string; color: string }) {
  const [, rerender] = useState(0)
  const candidates = [portraitUrl(characterId, expression), portraitUrl(characterId, 'normal')]
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
    <img
      className="portrait"
      src={src}
      alt={name}
      onError={() => {
        missing.add(src)
        rerender((n) => n + 1)
      }}
    />
  )
}

// answered：已經對這題作答。手機版這時把台詞移到選項下方（見 App 的 QuestionCard），上方只留立繪表情
export function CharacterStage({ reaction, answered }: { reaction: Reaction; answered: boolean }) {
  const { character, expression, text } = reaction
  return (
    <aside className={answered ? 'stage answered' : 'stage'} style={{ '--char': character.color } as React.CSSProperties}>
      <Portrait characterId={character.id} expression={expression} name={character.name} color={character.color} />
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
