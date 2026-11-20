import { useEffect, useState } from 'react'
import { PORTRAIT_WIDTH, portraitUrl, type Character, type Reaction } from './characters'
import { useOutfits, worn, type Bust } from './outfits'

// 載入失敗的立繪網址：立繪還沒做好時不要每次都重抓
const missing = new Set<string>()
const preloaded = new Set<string>()

/**
 * 會換表情的畫面（陪讀、劇情）先把會用到的表情載進來，第一次換表情時才不會空白一下（改進清單第 21 項）。
 * 地圖、商店、訊息只顯示固定的表情，不預載（地圖上五位都預載的話要多下載約 2 MB）。
 * 這套服裝缺某個表情時 Portrait 會退回別的圖：預載失敗就先記成缺圖，換到那個表情時直接用替代的
 */
export function usePreloadPortraits(characterId: string, expressions: string[], outfit?: string) {
  const list = expressions.join(',')
  useEffect(() => {
    for (const e of list.split(',')) {
      const url = portraitUrl(characterId, e, outfit)
      if (preloaded.has(url) || missing.has(url)) continue
      preloaded.add(url)
      const img = new Image()
      img.onerror = () => missing.add(url)
      img.src = url
    }
  }, [characterId, outfit, list])
}

// 小框只顯示胸像：圖片依 bust 放大、平移，外框裁掉其餘部分。電腦版的大立繪由 CSS 改回全身。
function bustStyle(bust: Bust | undefined) {
  if (!bust) return undefined
  return {
    '--bx': bust.x / PORTRAIT_WIDTH,
    '--by': bust.y / PORTRAIT_WIDTH,
    '--bw': bust.w / PORTRAIT_WIDTH,
  } as React.CSSProperties
}

// outfit：服裝的資料夾（劇情服裝或換上的服裝），那套服裝缺圖時退回基本服裝；bust：那套立繪的胸像範圍
export function Portrait(props: { character: Character; expression: string; outfit?: string; bust?: Bust }) {
  const { character, expression, outfit } = props
  const [, rerender] = useState(0)
  const { id, name, color } = character
  const bust = props.bust ?? character.bust
  const candidates = [
    ...(outfit ? [portraitUrl(id, expression, outfit), portraitUrl(id, 'normal', outfit)] : []),
    portraitUrl(id, expression),
    portraitUrl(id, 'normal'),
  ]
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

/** 平常的畫面用：她現在換上的服裝（outfits.ts）。劇情不用這個，維持劇本寫的服裝 */
export function WornPortrait({ character, expression }: { character: Character; expression: string }) {
  const outfit = worn(character.id, useOutfits())
  return <Portrait character={character} expression={expression} outfit={outfit?.folder ?? undefined} bust={outfit?.bust} />
}

// answered：已經對這題作答。手機版這時把台詞移到選項下方（見 App 的 QuestionCard），上方只留立繪表情
export function CharacterStage({ reaction, answered }: { reaction: Reaction; answered: boolean }) {
  const { character, expression, text } = reaction
  usePreloadPortraits(character.id, character.expressions, worn(character.id, useOutfits())?.folder ?? undefined)
  return (
    <aside className={answered ? 'stage answered' : 'stage'} style={{ '--char': character.color } as React.CSSProperties}>
      <WornPortrait character={character} expression={expression} />
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
