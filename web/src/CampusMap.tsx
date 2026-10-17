import { useState } from 'react'
import type { Character } from './characters'
import { Portrait } from './CharacterStage'
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

// 背景圖載入失敗（還沒做）的地點改用漸層色
const missingBg = new Set<string>()

function SpotBackground({ id }: { id: string }) {
  const [, rerender] = useState(0)
  const src = backgroundUrl(id)
  if (missingBg.has(src)) return null
  return (
    <img
      className="spot-bg"
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        missingBg.add(src)
        rerender((n) => n + 1)
      }}
    />
  )
}

/**
 * 角色模式的首頁：校園地圖。每位學姊待在自己的地點，點她就一起讀書；圖書館是錯題複習。
 * 參考 galgame 的「地圖型」選擇（見 plan.md「遊戲介面方向」）。
 */
export function CampusMap(props: {
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
}) {
  const { characters, subjects, affections, hasNewScene, hasStories, reviewDue, answeredToday, resume } = props
  return (
    <section className="campus" aria-label="校園地圖">
      <header className="campus-head">
        <div>
          <h2>今天要找誰一起讀書？</h2>
          <p>點學姊所在的地點，就會開始一起讀書（{props.roundSize} 題一回合）。</p>
        </div>
        <span className="campus-today">今天已作答 {answeredToday} 題</span>
      </header>

      <div className="campus-grid">
        {characters.map((c) => {
          const a = affections.get(c.id)
          const loc = c.location ?? 'cafe'
          return (
            <div key={c.id} className={`spot bg-${loc}`} style={{ '--char': c.color } as React.CSSProperties}>
              <SpotBackground id={loc} />
              <button className="spot-main" onClick={() => props.onStudy(c)} aria-label={`到${LOCATION_NAMES[loc] ?? loc}找${c.name}一起讀書`}>
                <span className="spot-place">{LOCATION_NAMES[loc] ?? loc}</span>
                <Portrait character={c} expression={hasNewScene(c) ? 'happy' : 'normal'} />
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

      <div className="campus-foot">
        <button className="ghost small" onClick={props.onFree}>
          {resume ? `繼續：${resume}` : '依考卷刷題'}
        </button>
      </div>
    </section>
  )
}
