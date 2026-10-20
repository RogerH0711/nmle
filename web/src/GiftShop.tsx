import { useEffect, useState } from 'react'
import { fillPlayer, type Character, type Line } from './characters'
import { Portrait } from './CharacterStage'
import { STAGE_NAMES, type Affection } from './affection'
import { AffectionMeter } from './Story'
import { EARN, GIFT_BONUS, givenToday, isLiked, type Earnings, type Gift, type GiftCatalog, type GiftRecord } from './shop'
import { STREAK_MIN_DAILY } from './messages'

interface Props {
  characters: Character[]
  catalog: GiftCatalog
  lines: Record<string, Line[]>
  affections: Map<string, Affection>
  gifts: GiftRecord[]
  balance: number
  earnings: Earnings
  player: string
  /** 送出禮物：寫進送禮紀錄，回傳她的反應 */
  onGive: (c: Character, g: Gift) => { expression: string; text: string | null }
  hasNewScene: (c: Character) => boolean
  onStory: (c: Character) => void
  onClose: () => void
}

interface Given {
  character: string
  gift: Gift
  expression: string
  text: string | null
  stageBefore: number
}

/** 台詞裡的 {gift}、{player} 換成實際的禮物名稱和稱呼 */
export function fillGiftLine(text: string, gift: Gift | undefined, player: string) {
  return fillPlayer(text, player).replaceAll('{gift}', gift?.name ?? '禮物')
}

/**
 * 禮物商店：用書籤買禮物送給學姊。書籤由作答紀錄推算（shop.ts），同一位學姊一天送一次。
 * 送禮可以稍微推進「熟識」「在意」，最多抵目標的 20%；之後的階段只會換到她的反應。
 */
export function GiftShop(props: Props) {
  const { characters, catalog, lines, affections, gifts, balance, earnings, player } = props
  const [selected, setSelected] = useState(characters[0]?.id ?? '')
  const [picking, setPicking] = useState<Gift | null>(null) // 點了禮物、還沒按送出
  const [given, setGiven] = useState<Given | null>(null) // 剛送出的禮物和她的反應

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  const c = characters.find((x) => x.id === selected)
  const a = c && affections.get(c.id)
  if (!c || !a) return null

  const mine = gifts.filter((g) => g.character_id === c.id)
  const today = givenToday(gifts, c.id)
  const giftOf = (id: string) => catalog.gifts.find((g) => g.id === id)
  const known = (g: Gift) => isLiked(catalog, c.id, g.id) && mine.some((x) => x.gift_id === g.id) // 送過才知道她喜歡
  const shown = given?.character === c.id ? given : null
  const shownBalance = Math.max(0, balance)

  const choose = (id: string) => {
    setSelected(id)
    setPicking(null)
    setGiven(null)
  }

  const send = () => {
    if (!picking) return
    const r = props.onGive(c, picking)
    setGiven({ character: c.id, gift: picking, ...r, stageBefore: a.stage })
    setPicking(null)
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="shop" role="dialog" aria-label="禮物" onClick={(e) => e.stopPropagation()}>
        <header className="status-head">
          <div>
            <h2>
              禮物 <span className="shop-balance">🔖 {shownBalance} 書籤</span>
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
                <Portrait character={x} expression="normal" />
              </span>
              {x.name}
            </button>
          ))}
        </div>

        <section className="shop-her" style={{ '--char': c.color } as React.CSSProperties}>
          <div className="shop-portrait">
            <Portrait character={c} expression={shown?.expression ?? 'normal'} />
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
              <p className="shop-hint">{bonusHint(a)}</p>
            )}
          </div>
        </section>

        {today && <p className="shop-note">今天已經送過{c.name}了，明天再來吧。</p>}

        <ul className="shop-grid">
          {[...catalog.gifts]
            .sort((x, y) => x.price - y.price)
            .map((g) => {
              const short = shownBalance < g.price
              return (
                <li key={g.id}>
                  <button
                    className={picking?.id === g.id ? 'shop-item picked' : 'shop-item'}
                    disabled={today || short}
                    onClick={() => setPicking(g)}
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

        {picking && (
          <div className="shop-confirm">
            <span>
              把{picking.name}送給{c.name}？（{picking.price} 書籤）
              <small>{picking.description}</small>
            </span>
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

        {mine.length > 0 && (
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
