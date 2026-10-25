import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  fetchMock, fetchStreaks, fetchWeekly, STREAK_MIN_DAILY, WEEKLY_MIN_ANSWERS,
  type MockRow, type StreakRow, type WeeklyRow,
} from './supabase'
import type { Index } from './types'
import { paperLabel } from './bank'
import { formatClock } from './mock'

type Tab = 'weekly' | 'streak' | 'mock'

const TABS: { id: Tab; label: string }[] = [
  { id: 'weekly', label: '週榜正確率' },
  { id: 'streak', label: '連續作答天數' },
  { id: 'mock', label: '模擬考' },
]

export function Leaderboard(props: { user: User | null; index: Index; onLogin: () => void; onClose: () => void }) {
  const { user, index, onLogin, onClose } = props
  const [tab, setTab] = useState<Tab>('weekly')
  const [weekly, setWeekly] = useState<WeeklyRow[] | null>(null)
  const [streaks, setStreaks] = useState<StreakRow[] | null>(null)
  const [mock, setMock] = useState<MockRow[] | null>(null)
  const [mockPaper, setMockPaper] = useState<string | null>(null) // null：不分考卷
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    setError(null)
    // 每次切到這個分頁都重抓，看到的是最新排名
    if (tab === 'weekly') fetchWeekly().then(setWeekly).catch((e) => setError(String(e)))
    if (tab === 'streak') fetchStreaks().then(setStreaks).catch((e) => setError(String(e)))
    if (tab === 'mock') {
      setMock(null)
      fetchMock(mockPaper).then(setMock).catch((e) => setError(String(e)))
    }
  }, [tab, user, mockPaper])

  return (
    <main className="card board">
      <div className="board-head">
        <h2>排行榜</h2>
        <button className="ghost small" onClick={onClose}>
          回到刷題
        </button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!user ? (
        <div className="board-empty">
          <p>登入後才能看排行榜，你的成績也才會列進去。</p>
          <button className="primary small" onClick={onLogin}>
            登入
          </button>
        </div>
      ) : error ? (
        <p className="board-empty">排行榜載入失敗：{error}</p>
      ) : tab === 'weekly' ? (
        <WeeklyTable rows={weekly} />
      ) : tab === 'streak' ? (
        <StreakTable rows={streaks} />
      ) : (
        <MockTable rows={mock} index={index} paper={mockPaper} onPaper={setMockPaper} />
      )}
    </main>
  )
}

function WeeklyTable({ rows }: { rows: WeeklyRow[] | null }) {
  if (!rows) return <p className="board-empty">載入中…</p>
  let rank = 0
  return (
    <>
      <p className="board-note">
        本週（週一 00:00 起）的作答。同一題同一天只算第一次，至少 {WEEKLY_MIN_ANSWERS} 題才排名。
      </p>
      {rows.length === 0 ? (
        <p className="board-empty">這週還沒有人作答。</p>
      ) : (
        <table className="board-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>暱稱</th>
              <th>正確率</th>
              <th>題數</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.is_me ? 'me' : undefined}>
                <td>{r.qualified ? ++rank : '—'}</td>
                <td>
                  {r.display_name}
                  {r.is_me && <span className="you">你</span>}
                </td>
                <td>{r.accuracy.toFixed(1)}%</td>
                <td>
                  {r.answered}
                  {!r.qualified && <span className="pending">差 {WEEKLY_MIN_ANSWERS - r.answered}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function StreakTable({ rows }: { rows: StreakRow[] | null }) {
  if (!rows) return <p className="board-empty">載入中…</p>
  return (
    <>
      <p className="board-note">一天至少作答 {STREAK_MIN_DAILY} 題才算一天；今天或昨天有作答才算還在連續中。</p>
      {rows.length === 0 ? (
        <p className="board-empty">目前沒有人在連續作答中。</p>
      ) : (
        <table className="board-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>暱稱</th>
              <th>連續天數</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.is_me ? 'me' : undefined}>
                <td>{i + 1}</td>
                <td>
                  {r.display_name}
                  {r.is_me && <span className="you">你</span>}
                </td>
                <td>{r.streak} 天</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function MockTable(props: { rows: MockRow[] | null; index: Index; paper: string | null; onPaper: (p: string | null) => void }) {
  const { rows, index, paper, onPaper } = props
  const label = (id: string) => {
    const p = index.papers.find((x) => x.id === id)
    return p ? paperLabel(p) : id
  }
  return (
    <>
      <div className="board-filter">
        <select aria-label="考卷" value={paper ?? ''} onChange={(e) => onPaper(e.target.value || null)}>
          <option value="">所有考卷（各人最好的一份）</option>
          {index.papers.map((p) => (
            <option key={p.id} value={p.id}>
              {paperLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <p className="board-note">每份考卷只採計第一次模擬考；同分時用時短的排前面。</p>
      {!rows ? (
        <p className="board-empty">載入中…</p>
      ) : rows.length === 0 ? (
        <p className="board-empty">{paper ? '這份考卷還沒有人考過模擬考。' : '還沒有人考過模擬考。'}</p>
      ) : (
        <table className="board-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>暱稱</th>
              <th>分數</th>
              <th>用時</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.is_me ? 'me' : undefined}>
                <td>{i + 1}</td>
                <td>
                  {r.display_name}
                  {r.is_me && <span className="you">你</span>}
                  {!paper && (
                    <span className="pending">
                      {label(r.paper_id)}
                      {r.papers > 1 && `・考過 ${r.papers} 份`}
                    </span>
                  )}
                </td>
                <td>
                  {r.score}
                  {r.total !== 100 && <span className="pending">/ {r.total}</span>}
                </td>
                <td>{formatClock(r.seconds * 1000)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
