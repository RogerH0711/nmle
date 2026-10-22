import { useEffect, useState } from 'react'
import { dataUrl } from './bank'
import type { Character } from './characters'
import { WornPortrait } from './CharacterStage'
import type { Affection } from './affection'
import { AffectionMeter } from './Story'
import { backgroundUrl } from './stories'

// 地點名稱（背景 id 見 data/backgrounds/，characters.json 的 location 指到這裡）
export const LOCATION_NAMES: Record<string, string> = {
  cafe: '咖啡廳「夜燈」',
  library: '圖書館',
  anatomy_lab: '解剖教室',
  lab: '微免實驗室',
  hospital: '醫院',
  track: '操場',
  night_street: '宿舍前',
  festival: '夏日祭典',
  stairwell: '醫院逃生梯',
}

const REVIEW_LOCATION = 'library' // 錯題複習在圖書館

// ---------- 地圖設定（data/map.json） ----------

type Layout = 'wide' | 'tall' // 電腦用橫式圖、手機用直式圖

// 和 styles.css 手機版的斷點一致（max-width: 599px）
const TALL_QUERY = '(max-width: 599px)'

/** 目前螢幕寬度用哪種版面。兩種都渲染再用 CSS 藏起一種的話，瀏覽器兩張地圖都會下載（各約 240 KB） */
function useLayout(): Layout {
  const query = () => (window.matchMedia(TALL_QUERY).matches ? 'tall' : 'wide')
  const [layout, setLayout] = useState<Layout>(query)
  useEffect(() => {
    // 斷點的 change 事件之外也聽 resize：有些情況（手機轉向、瀏覽器縮放）只會發其中一種
    const mq = window.matchMedia(TALL_QUERY)
    const onChange = () => setLayout(query())
    mq.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])
  return layout
}

interface MapLayout {
  image: string
  spots: Record<string, [number, number]> // 地點 id → [x%, y%]
}
type MapConfig = Record<Layout, MapLayout>

let mapConfig: Promise<MapConfig | null> | null = null
function loadMapConfig() {
  mapConfig ??= fetch(dataUrl('map.json'))
    .then((r) => (r.ok ? (r.json() as Promise<MapConfig>) : null))
    .catch(() => null)
  return mapConfig
}

// 載入失敗（還沒做）的圖：背景改用漸層色，地圖改用格子
const missingImg = new Set<string>()

function SpotBackground({ id }: { id: string }) {
  const [, rerender] = useState(0)
  const src = backgroundUrl(id)
  if (missingImg.has(src)) return null
  return (
    <img
      className="spot-bg"
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        missingImg.add(src)
        rerender((n) => n + 1)
      }}
    />
  )
}

interface Props {
  characters: Character[]
  subjects: Record<string, string>
  affections: Map<string, Affection>
  hasNewScene: (c: Character) => boolean
  hasStories: (c: Character) => boolean
  roundSize: number
  reviewDue: number
  answeredToday: number
  resume: string | null // 進行中的回合（例如「和顏緋讀書 5 / 20」），沒有就是 null
  onStudy: (c: Character) => void
  onStories: (c: Character) => void
  onReview: () => void
  onFree: () => void
  onStatus: () => void
  balance: number | null // 書籤餘額；禮物清單還沒載入時是 null，不顯示按鈕
  onShop: () => void
  unreadMessages: number
  onMessages: () => void
  player: string // 學姊們怎麼叫你
  onPlayer: () => void
}

/**
 * 角色模式的首頁：校園地圖。每位學姊待在自己的地點，點她就一起讀書；圖書館是錯題複習。
 * 參考 galgame 的「地圖型」選擇（見 docs/design.md「遊戲介面方向」）。
 * 有校園俯視圖（data/map.json）時，地點是圖上的標記；圖還沒做好時，地點排成格子。
 */
export function CampusMap(props: Props) {
  const [config, setConfig] = useState<MapConfig | null>(null)
  const [failed, setFailed] = useState<Layout[]>([])
  const layout = useLayout()
  useEffect(() => {
    void loadMapConfig().then((c) => {
      if (!c) return
      setFailed((['wide', 'tall'] as Layout[]).filter((l) => missingImg.has(backgroundUrl(c[l].image))))
      setConfig(c)
    })
  }, [])

  const layouts = (['wide', 'tall'] as Layout[]).filter((l) => config && !failed.includes(l))
  const hasMap = layouts.includes(layout)
  const fail = (l: Layout) => {
    if (config) missingImg.add(backgroundUrl(config[l].image))
    setFailed((f) => [...f, l])
  }

  return (
    <section className="campus" aria-label="校園地圖">
      <header className="campus-head">
        <div>
          <h2>今天要找誰一起讀書？</h2>
          <p>點學姊所在的地點，就會開始一起讀書（{props.roundSize} 題一回合）。</p>
        </div>
        <div className="campus-actions">
          <span className="campus-today">今天已作答 {props.answeredToday} 題</span>
          <button className="ghost small messages-btn" onClick={props.onMessages} aria-label={props.unreadMessages ? `訊息（${props.unreadMessages} 則未讀）` : '訊息'}>
            訊息
            {props.unreadMessages > 0 && <span className="unread">{props.unreadMessages}</span>}
          </button>
          <button className="ghost small" onClick={props.onStatus}>
            能力值
          </button>
          {props.balance !== null && (
            <button className="ghost small" onClick={props.onShop} aria-label={`商店（${props.balance} 書籤）`}>
              商店 <span className="shop-wallet">🔖 {props.balance}</span>
            </button>
          )}
        </div>
      </header>

      {/* 這種版面的圖還沒做好（或載入失敗）時，地點排成格子 */}
      {hasMap ? (
        <>
          <MapView key={layout} layout={layout} config={config![layout]} onFail={() => fail(layout)} {...props} />
          <Roster {...props} />
        </>
      ) : (
        <SpotGrid {...props} />
      )}

      <div className="campus-foot">
        <button className="ghost small" onClick={props.onFree}>
          {props.resume ? `繼續：${props.resume}` : '依考卷刷題'}
        </button>
        <button className="ghost small" onClick={props.onPlayer}>
          稱呼：{props.player}
        </button>
      </div>
    </section>
  )
}

/** 地點卡片排成格子（還沒有校園俯視圖時用） */
function SpotGrid(props: Props) {
  const { characters, subjects, affections, hasNewScene, hasStories, reviewDue } = props
  return (
    <div className="campus-grid">
      {characters.map((c) => {
        const a = affections.get(c.id)
        const loc = c.location ?? 'cafe'
        return (
          <div key={c.id} className={`spot bg-${loc}`} style={{ '--char': c.color } as React.CSSProperties}>
            <SpotBackground id={loc} />
            <button className="spot-main" onClick={() => props.onStudy(c)} aria-label={`到${LOCATION_NAMES[loc] ?? loc}找${c.name}一起讀書`}>
              <span className="spot-place">{LOCATION_NAMES[loc] ?? loc}</span>
              <WornPortrait character={c} expression={hasNewScene(c) ? 'happy' : 'normal'} />
              <span className="spot-info">
                <strong>
                  {c.name}
                  {hasNewScene(c) && <span className="new-badge">新劇情</span>}
                </strong>
                <span className="spot-subjects">{c.subjects.map((s) => subjects[s] ?? s).join('、')}</span>
                {a && <AffectionMeter affection={a} />}
              </span>
            </button>
            {hasStories(c) && (
              <button className="spot-story" onClick={() => props.onStories(c)}>
                劇情
              </button>
            )}
          </div>
        )
      })}

      <div className={`spot spot-review bg-${REVIEW_LOCATION}`}>
        <SpotBackground id={REVIEW_LOCATION} />
        <button className="spot-main" onClick={props.onReview} disabled={!reviewDue}>
          <span className="spot-place">{LOCATION_NAMES[REVIEW_LOCATION]}</span>
          <span className="spot-info">
            <strong>錯題複習</strong>
            <span className="spot-count">{reviewDue ? `今天到期 ${reviewDue} 題` : '今天沒有到期的錯題'}</span>
          </span>
        </button>
      </div>
    </div>
  )
}

/** 校園俯視圖：學姊的頭像標在她的地點上 */
function MapView(props: Props & { layout: Layout; config: MapLayout; onFail: () => void }) {
  const { layout, config, characters, hasNewScene, reviewDue } = props
  const at = (loc: string) => {
    const [x, y] = config.spots[loc] ?? [50, 50]
    return { left: `${x}%`, top: `${y}%` }
  }
  return (
    <div className={`campus-map map-${layout}`}>
      <img className="campus-map-img" src={backgroundUrl(config.image)} alt="校園地圖" onError={props.onFail} />
      {characters.map((c) => {
        const loc = c.location ?? 'cafe'
        return (
          <button
            key={c.id}
            className="pin"
            style={{ ...at(loc), '--char': c.color } as React.CSSProperties}
            onClick={() => props.onStudy(c)}
            aria-label={`到${LOCATION_NAMES[loc] ?? loc}找${c.name}一起讀書`}
          >
            <span className="pin-avatar">
              <WornPortrait character={c} expression={hasNewScene(c) ? 'happy' : 'normal'} />
              {hasNewScene(c) && <span className="pin-new" title="有新劇情" />}
            </span>
            <span className="pin-label">
              <strong>{c.name}</strong>
              <span>{LOCATION_NAMES[loc] ?? loc}</span>
            </span>
          </button>
        )
      })}
      <button className="pin pin-review" style={at(REVIEW_LOCATION)} onClick={props.onReview} disabled={!reviewDue}>
        <span className="pin-avatar pin-icon" aria-hidden>
          {reviewDue || '✓'}
        </span>
        <span className="pin-label">
          <strong>錯題複習</strong>
          <span className="pin-count">{reviewDue ? `到期 ${reviewDue} 題` : '今天沒有'}</span>
        </span>
      </button>
    </div>
  )
}

/** 地圖下方的學姊狀態列：好感度、下一階進度、劇情 */
function Roster(props: Props) {
  const { characters, affections, hasNewScene, hasStories } = props
  return (
    <ul className="roster">
      {characters.map((c) => {
        const a = affections.get(c.id)
        return (
          <li key={c.id} style={{ '--char': c.color } as React.CSSProperties}>
            <span className="roster-name">
              {c.name}
              {hasNewScene(c) && <span className="new-badge">新</span>}
            </span>
            {a && <AffectionMeter affection={a} />}
            {hasStories(c) && (
              <button className="roster-story" onClick={() => props.onStories(c)}>
                劇情
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
