import { useEffect, useState } from 'react'
import { fillPlayer, type Character, type Line } from './characters'
import { Portrait, WornPortrait } from './CharacterStage'
import { STAGE_NAMES, type Affection } from './affection'
import { AffectionMeter } from './Story'
import {
  EARN, GIFT_BONUS, givenToday, isGiftRecord, isLiked, type Earnings, type Gift, type GiftCatalog, type GiftRecord,
} from './shop'
import {
  boughtOutfits, outfitsOf, outfitStatus, useOutfits, wear, worn, type Outfit, type OutfitCatalog, type OutfitStatus,
} from './outfits'
import { STREAK_MIN_DAILY } from './messages'
import { sfx } from './audio'
import { sceneId } from './stories'

interface Props {
  characters: Character[]
  catalog: GiftCatalog
  outfits: OutfitCatalog
  lines: Record<string, Line[]>
  affections: Map<string, Affection>
  gifts: GiftRecord[] // 送禮紀錄（含買服裝）
  seen: Set<string> // 這台裝置看過的劇情：劇情服裝看完那段才解鎖
  balance: number
  earnings: Earnings
  player: string
  /** 送出禮物：寫進送禮紀錄，回傳她的反應 */
  onGive: (c: Character, g: Gift) => { expression: string; text: string | null }
  /** 買服裝送她：寫進送禮紀錄並換上，回傳她的反應 */
  onBuyOutfit: (c: Character, o: Outfit) => { expression: string; text: string | null }
  hasNewScene: (c: Character) => boolean
  onStory: (c: Character) => void
  onClose: () => void
}

interface Given {
  character: string
  name: string // 送了什麼
  expression: string
  text: string | null
  stageBefore: number
}

type Picking = { kind: 'gift'; gift: Gift } | { kind: 'outfit'; outfit: Outfit }

/** 台詞裡的 {gift}、{player} 換成實際的禮物名稱和稱呼 */
export function fillGiftLine(text: string, gift: Gift | undefined, player: string) {
  return fillPlayer(text, player).replaceAll('{gift}', gift?.name ?? '禮物')
}

/**
 * 商店：用書籤買禮物或服裝送給學姊。書籤由作答紀錄推算（shop.ts）。
 * - 禮物：同一位學姊一天送一次；可以稍微推進「熟識」「在意」，最多抵目標的 20%，之後的階段只會換到她的反應。
 * - 服裝（outfits.ts）：好感度到了才能買，買了就換上，可以隨時換回來；不加好感度、不佔一天一次。
 */
export function GiftShop(props: Props) {
  const { characters, catalog, lines, affections, gifts, balance, earnings, player } = props
  const [selected, setSelected] = useState(characters[0]?.id ?? '')
  const [mode, setMode] = useState<'gift' | 'outfit'>('gift')
  const [picking, setPicking] = useState<Picking | null>(null) // 點了商品、還沒按送出
  const [given, setGiven] = useState<Given | null>(null) // 剛送出的東西和她的反應
  const outfitState = useOutfits()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  // 送禮後升階：放升階音效
  const leveled = !!given && (affections.get(given.character)?.stage ?? 0) > given.stageBefore
  useEffect(() => {
    if (leveled) sfx('unlock')
  }, [leveled])

  const c = characters.find((x) => x.id === selected)
  const a = c && affections.get(c.id)
  if (!c || !a) return null

  const giftRecords = gifts.filter((g) => isGiftRecord(catalog, g)) // 買服裝不算一天一次、不列在「送過的禮物」
  const mine = giftRecords.filter((g) => g.character_id === c.id)
  const today = givenToday(giftRecords, c.id)
  const giftOf = (id: string) => catalog.gifts.find((g) => g.id === id)
  const known = (g: Gift) => isLiked(catalog, c.id, g.id) && mine.some((x) => x.gift_id === g.id) // 送過才知道她喜歡
  const shown = given?.character === c.id ? given : null
  const shownBalance = Math.max(0, balance)

  const bought = boughtOutfits(props.outfits, gifts)
  const wearing = worn(c.id, outfitState)?.id ?? null
  const outfitList = outfitsOf(props.outfits, c.id)
  const seenScene = (characterId: string, stage: number) => props.seen.has(sceneId(characterId, stage))
  const statusOf = (o: Outfit) => outfitStatus(o, { stage: a.stage, bought, seenScene })
  const isWearing = (o: Outfit) => (o.folder === null ? wearing === null : wearing === o.id)

  const choose = (id: string) => {
    setSelected(id)
    setPicking(null)
    setGiven(null)
  }

  const switchMode = (m: 'gift' | 'outfit') => {
    setMode(m)
    setPicking(null)
  }

  const send = () => {
    if (!picking) return
    const r = picking.kind === 'gift' ? props.onGive(c, picking.gift) : props.onBuyOutfit(c, picking.outfit)
    const name = picking.kind === 'gift' ? picking.gift.name : picking.outfit.name
    setGiven({ character: c.id, name, ...r, stageBefore: a.stage })
    setPicking(null)
  }

  const clickOutfit = (o: Outfit, s: OutfitStatus) => {
    if (s.kind === 'owned') {
      setPicking(null)
      setGiven(null)
      wear(c.id, o.folder === null ? null : o.id)
    } else if (s.kind === 'buy') setPicking({ kind: 'outfit', outfit: o })
  }

  // 正在看的服裝先換上給你看；送出前不算數
  const preview = picking?.kind === 'outfit' ? picking.outfit : null

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="shop" role="dialog" aria-label="商店" onClick={(e) => e.stopPropagation()}>
        <header className="status-head">
          <div>
            <h2>
              商店 <span className="shop-balance">🔖 {shownBalance} 書籤</span>
            </h2>
            <p>
              書籤怎麼來：每題第一次答對 +{EARN.firstCorrect}、錯題按時複習答對 +{EARN.reviewPass}、一天寫滿 {STREAK_MIN_DAILY} 題 +
              {EARN.studyDay}。目前賺了 {earnings.total}（答對 {earnings.firstCorrect} 題、複習 {earnings.reviewPasses} 次、{earnings.studyDays}{' '}
              天）。
            </p>
          </div>
          <button className="ghost small" onClick={props.onClose}>
            關閉
          </button>
        </header>

        <div className="shop-tabs" role="tablist" aria-label="送給誰">
          {characters.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={x.id === c.id}
              className={x.id === c.id ? 'shop-tab active' : 'shop-tab'}
              style={{ '--char': x.color } as React.CSSProperties}
              onClick={() => choose(x.id)}
            >
              <span className="status-avatar">
                <WornPortrait character={x} expression="normal" />
              </span>
              {x.name}
            </button>
          ))}
        </div>

        <section className="shop-her" style={{ '--char': c.color } as React.CSSProperties}>
          <div className="shop-portrait">
            {preview ? (
              <Portrait character={c} expression="normal" outfit={preview.folder ?? undefined} bust={preview.bust} />
            ) : (
              <WornPortrait character={c} expression={shown?.expression ?? 'normal'} />
            )}
          </div>
          <div className="shop-her-info">
            <strong>{c.name}</strong>
            <AffectionMeter affection={a} />
            {shown ? (
              <>
                <p className="shop-speech">{shown.text ?? '……謝謝。'}</p>
                {a.stage > shown.stageBefore && (
                  <p className="shop-unlock">
                    好感度提升到「{STAGE_NAMES[a.stage]}」！
                    {props.hasNewScene(c) && (
                      <button className="primary small" onClick={() => props.onStory(c)}>
                        看新劇情
                      </button>
                    )}
                  </p>
                )}
              </>
            ) : (
              <p className="shop-hint">
                {mode === 'gift'
                  ? bonusHint(a)
                  : '服裝買了就是送給她，會馬上換上，之後可以隨時換回來；不會加好感度。換上的服裝用在刷題、地圖和訊息，劇情照劇本穿。'}
              </p>
            )}
          </div>
        </section>

        <div className="shop-modes" role="tablist" aria-label="商品種類">
          {(['gift', 'outfit'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => switchMode(m)}>
              {m === 'gift' ? '禮物' : '服裝'}
            </button>
          ))}
        </div>

        {mode === 'gift' && today && <p className="shop-note">今天已經送過{c.name}了，明天再來吧。</p>}

        {mode === 'gift' ? (
          <ul className="shop-grid">
            {[...catalog.gifts]
              .sort((x, y) => x.price - y.price)
              .map((g) => {
                const short = shownBalance < g.price
                return (
                  <li key={g.id}>
                    <button
                      className={picking?.kind === 'gift' && picking.gift.id === g.id ? 'shop-item picked' : 'shop-item'}
                      disabled={today || short}
                      onClick={() => setPicking({ kind: 'gift', gift: g })}
                      title={g.description}
                    >
                      <span className="shop-icon" aria-hidden>
                        {g.icon}
                      </span>
                      <span className="shop-name">{g.name}</span>
                      <span className="shop-price">🔖 {g.price}</span>
                      {known(g) && <span className="shop-liked">她喜歡</span>}
                    </button>
                  </li>
                )
              })}
          </ul>
        ) : (
          <ul className="shop-grid outfit-grid">
            {outfitList.map((o) => {
              const s = statusOf(o)
              const on = s.kind === 'owned' && isWearing(o)
              const short = s.kind === 'buy' && shownBalance < s.price
              return (
                <li key={o.id}>
                  <button
                    className={`shop-item outfit-item${preview?.id === o.id ? ' picked' : ''}${on ? ' wearing' : ''}`}
                    disabled={on || s.kind === 'stage' || s.kind === 'story' || short}
                    onClick={() => clickOutfit(o, s)}
                    title={o.description}
                  >
                    <span className="outfit-thumb">
                      <Portrait character={c} expression="normal" outfit={o.folder ?? undefined} bust={o.bust} />
                    </span>
                    <span className="shop-name">{o.name}</span>
                    <span className={s.kind === 'buy' ? 'shop-price' : 'outfit-state'}>{outfitLabel(s, on)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {picking && (
          <div className="shop-confirm">
            {picking.kind === 'gift' ? (
              <span>
                把{picking.gift.name}送給{c.name}？（{picking.gift.price} 書籤）
                <small>{picking.gift.description}</small>
              </span>
            ) : (
              <span>
                把「{picking.outfit.name}」送給{c.name}？（{picking.outfit.price} 書籤）
                <small>{picking.outfit.description}</small>
              </span>
            )}
            <span className="shop-confirm-actions">
              <button className="ghost small" onClick={() => setPicking(null)}>
                再想想
              </button>
              <button className="primary small" onClick={send}>
                送出
              </button>
            </span>
          </div>
        )}

        {mode === 'gift' && mine.length > 0 && (
          <section className="shop-album">
            <h3>送過的禮物</h3>
            <ol>
              {[...mine].reverse().map((r) => {
                const g = giftOf(r.gift_id)
                const line = r.line_id ? (lines[c.id] ?? []).find((l) => l.id === r.line_id) : undefined
                return (
                  <li key={r.id}>
                    <span className="shop-album-gift">
                      {g?.icon} {g?.name ?? r.gift_id}
                      <small>{new Date(r.given_at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}</small>
                    </span>
                    {line && <span className="shop-album-line">「{fillGiftLine(line.text, g, player)}」</span>}
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}

/** 服裝格子下方的狀態 */
function outfitLabel(s: OutfitStatus, wearing: boolean) {
  switch (s.kind) {
    case 'owned':
      return wearing ? '穿著中' : '換上'
    case 'buy':
      return `🔖 ${s.price}`
    case 'stage':
      return `🔒 好感度「${STAGE_NAMES[s.stage]}」`
    case 'story':
      return `🔒「${STAGE_NAMES[s.stage]}」劇情`
  }
}

/** 現在送禮對好感度有沒有幫助 */
function bonusHint(a: Affection) {
  const next = a.next
  if (!next) return '送禮不影響好感度，但她還是會很開心。'
  if (!GIFT_BONUS.stages.includes(a.stage)) {
    const need = a.stage === 2 ? '正確率' : '模擬考'
    return `「${STAGE_NAMES[a.stage + 1]}」要靠${need}，送禮不會加進度，但她還是會很開心。`
  }
  const cap = Math.round(next.target * GIFT_BONUS.cap)
  const bonus = next.bonus ?? 0
  if (bonus >= cap) return `這一階禮物能加的進度已經滿了（${cap} ${next.unit}），剩下的要靠讀書囉。`
  return `送禮可以幫「${STAGE_NAMES[a.stage + 1]}」加一點進度：目前加了 ${bonus} ${next.unit}，最多 ${cap} ${next.unit}。她喜歡的禮物加倍。`
}
