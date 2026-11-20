import { useEffect } from 'react'
import type { Question } from './types'
import { sfx } from './audio'
import { isCorrect, type Run } from './run'

// 一回合結束：各學科的成績、好感度升階、重新開始或重做錯題

export function Summary(props: {
  run: Run
  questions: Map<string, Question>
  subjects: Record<string, string>
  onRestart?: () => void
  restartLabel: string
  onRetryWrong: () => void
  unlock?: { text: string; onPlay?: () => void } // 這回合好感度升階
}) {
  const { run, questions, subjects, onRestart, restartLabel, onRetryWrong, unlock } = props
  const unlocked = !!unlock
  useEffect(() => {
    if (unlocked) sfx('unlock')
  }, [unlocked])
  const rows = new Map<string, { total: number; correct: number }>()
  let wrong = 0
  for (const id of run.queue) {
    const q = questions.get(id)
    const p = run.picks[id]
    if (!q || !p) continue
    const key = q.subject ?? 'unknown'
    const row = rows.get(key) ?? { total: 0, correct: 0 }
    row.total++
    if (isCorrect(q, p)) row.correct++
    else wrong++
    rows.set(key, row)
  }

  return (
    <main className="card summary">
      <h2>{run.kind === 'review' ? '今天的複習完成了' : run.kind === 'mock' ? '檢討完成' : '這回合結束'}</h2>
      {unlock && (
        <div className="unlock">
          <span>{unlock.text}</span>
          {unlock.onPlay && (
            <button className="primary small" onClick={unlock.onPlay}>
              看新劇情
            </button>
          )}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>學科</th>
            <th>答對</th>
            <th>正確率</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].map(([key, r]) => (
            <tr key={key}>
              <td>{subjects[key] ?? '未分類'}</td>
              <td>
                {r.correct} / {r.total}
              </td>
              <td>{Math.round((r.correct / r.total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="nav">
        {onRestart ? (
          <button className="ghost" onClick={onRestart}>
            {restartLabel}
          </button>
        ) : (
          <span />
        )}
        <button className="primary" onClick={onRetryWrong} disabled={wrong === 0}>
          重做錯題（{wrong}）
        </button>
      </nav>
    </main>
  )
}
