import { useEffect, useMemo } from 'react'
import type { AnswerRecord } from './answers'
import type { Character } from './characters'
import { Portrait } from './CharacterStage'
import type { SubjectMap } from './affection'
import { abilities, grade, MIN_ANSWERS, PASS_RATE, RECENT, weakest, type Ability } from './abilities'

// 雷達圖上的學科簡稱（全名太長放不下）
const SHORT: Record<string, string> = {
  anatomy: '解剖',
  embryology: '胚胎',
  histology: '組織',
  physiology: '生理',
  biochemistry: '生化',
  microbiology: '微免',
  parasitology: '寄生蟲',
  pharmacology: '藥理',
  pathology: '病理',
  public_health: '公衛',
}

interface Props {
  characters: Character[]
  subjectNames: Record<string, string>
  records: AnswerRecord[]
  map: SubjectMap
  onStudy: (c: Character) => void
  onClose: () => void
}

/**
 * 狀態面板：各科最近的正確率當成「能力值」，像模擬經營型 galgame 的能力畫面（見 docs/design.md「遊戲介面方向」）。
 * 雷達圖看整體，下面依負責的學姊分組列出各科。最弱的一科建議找負責的學姊一起讀書。
 */
export function StatusPanel({ characters, subjectNames, records, map, onStudy, onClose }: Props) {
  // 學科依學姊排，沒有人負責的學科排最後
  const order = useMemo(() => {
    const owned = characters.flatMap((c) => c.subjects)
    return [...owned, ...Object.keys(subjectNames).filter((s) => !owned.includes(s))]
  }, [characters, subjectNames])
  const list = useMemo(() => abilities(order, records, map), [order, records, map])
  const bySubject = new Map(list.map((a) => [a.subject, a]))
  const ownerOf = (s: string) => characters.find((c) => c.subjects.includes(s))
  const name = (s: string) => subjectNames[s] ?? s

  const rated = list.filter((a) => a.rate !== null)
  const passed = rated.filter((a) => a.rate! >= PASS_RATE).length
  const answered = list.reduce((n, a) => n + a.answered, 0)
  const weak = answered ? weakest(list) : undefined
  const weakOwner = weak && ownerOf(weak.subject)
  const unowned = order.filter((s) => !ownerOf(s))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="status" role="dialog" aria-label="能力值" onClick={(e) => e.stopPropagation()}>
        <header className="status-head">
          <div>
            <h2>能力值</h2>
            <p>
              各科最近 {RECENT} 題的正確率，同一題同一天只算第一次。寫滿 {MIN_ANSWERS} 題才有能力值，虛線是及格線 {PASS_RATE}%。
            </p>
          </div>
          <button className="ghost small" onClick={onClose}>
            關閉
          </button>
        </header>

        <div className="status-top">
          <Radar order={order} abilities={bySubject} colorOf={(s) => ownerOf(s)?.color} />
          <div className="status-summary">
            <div>
              <strong>{answered}</strong>
              <span>總作答（題）</span>
            </div>
            <div>
              <strong>
                {passed} / {rated.length}
              </strong>
              <span>及格的學科（有能力值的）</span>
            </div>
            {weak && (
              <div className="status-advice" style={{ '--char': weakOwner?.color } as React.CSSProperties}>
                <span>
                  {weak.rate !== null
                    ? `最需要加強：${name(weak.subject)}（${weak.rate}%）`
                    : `寫得最少：${name(weak.subject)}（${weak.answered} 題）`}
                </span>
                {weakOwner && (
                  <button
                    className="primary small"
                    onClick={() => {
                      onClose()
                      onStudy(weakOwner)
                    }}
                  >
                    找{weakOwner.name}一起讀書
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {characters.map((c) => (
          <section key={c.id} className="status-group" style={{ '--char': c.color } as React.CSSProperties}>
            <h3>
              <span className="status-avatar">
                <Portrait character={c} expression="normal" />
              </span>
              {c.name}
              <small>{c.title}</small>
            </h3>
            {c.subjects.map((s) => bySubject.get(s) && <Row key={s} name={name(s)} ability={bySubject.get(s)!} />)}
          </section>
        ))}
        {unowned.length > 0 && (
          <section className="status-group">
            <h3>其他學科</h3>
            {unowned.map((s) => bySubject.get(s) && <Row key={s} name={name(s)} ability={bySubject.get(s)!} />)}
          </section>
        )}
      </div>
    </div>
  )
}

function Row({ name, ability: a }: { name: string; ability: Ability }) {
  const g = a.rate === null ? null : grade(a.rate)
  return (
    <div className="status-row">
      <span className="status-subject">{name}</span>
      <span className="status-bar" aria-hidden>
        <span style={{ width: `${a.rate ?? 0}%` }} />
        <i style={{ left: `${PASS_RATE}%` }} />
      </span>
      <span className="status-rate">{a.rate === null ? '—' : `${a.rate}%`}</span>
      <span className={g ? `status-grade g-${g}` : 'status-grade none'}>{g ?? '?'}</span>
      <span className="status-detail">
        {a.rate === null ? `再寫 ${MIN_ANSWERS - a.answered} 題就有能力值・` : ''}
        已寫 {a.covered} / {a.total} 題
        {a.change !== null && a.change !== 0 && (
          <span className={a.change > 0 ? 'up' : 'down'}>
            {a.change > 0 ? `　▲${a.change}` : `　▼${-a.change}`}
          </span>
        )}
      </span>
    </div>
  )
}

/** 雷達圖：每科一個軸，外圈 100%，虛線圈是及格線 */
function Radar({
  order,
  abilities,
  colorOf,
}: {
  order: string[]
  abilities: Map<string, Ability>
  colorOf: (s: string) => string | undefined
}) {
  const R = 90
  const n = order.length
  const point = (i: number, r: number) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n
    return [r * Math.cos(t), r * Math.sin(t)] as const
  }
  const ring = (r: number) => order.map((_, i) => point(i, r).join(',')).join(' ')
  const shape = order.map((s, i) => point(i, ((abilities.get(s)?.rate ?? 0) / 100) * R).join(',')).join(' ')

  return (
    <svg className="status-radar" viewBox="-150 -125 300 250" role="img" aria-label="各科能力值雷達圖">
      {[20, 40, 80, 100].map((p) => (
        <polygon key={p} points={ring((p / 100) * R)} className="radar-ring" />
      ))}
      <polygon points={ring((PASS_RATE / 100) * R)} className="radar-ring pass" />
      {order.map((_, i) => {
        const [x, y] = point(i, R)
        return <line key={i} x1={0} y1={0} x2={x} y2={y} className="radar-axis" />
      })}
      <polygon points={shape} className="radar-shape" />
      {order.map((s, i) => {
        const a = abilities.get(s)
        const [x, y] = point(i, R + 14)
        const anchor = Math.abs(x) < 10 ? 'middle' : x > 0 ? 'start' : 'end'
        return (
          <text
            key={s}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="radar-label"
            style={{ fill: colorOf(s) }}
          >
            {SHORT[s] ?? s}
            <tspan className="radar-value">{a?.rate === null || !a ? ' ?' : ` ${a.rate}`}</tspan>
          </text>
        )
      })}
    </svg>
  )
}
