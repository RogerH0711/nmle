import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  fetchStreaks, fetchWeekly, signInWithGoogle, STREAK_MIN_DAILY, WEEKLY_MIN_ANSWERS,
  type StreakRow, type WeeklyRow,
} from './supabase'

type Tab = 'weekly' | 'streak' | 'mock'

const TABS: { id: Tab; label: string }[] = [
  { id: 'weekly', label: '週榜正確率' },
  { id: 'streak', label: '連續作答天數' },
  { id: 'mock', label: '模擬考' },
]

export function Leaderboard({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('weekly')
  const [weekly, setWeekly] = useState<WeeklyRow[] | null>(null)
  const [streaks, setStreaks] = useState<StreakRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    setError(null)
    // 每次切到這個分頁都重抓，看到的是最新排名
    if (tab === 'weekly') fetchWeekly().then(setWeekly).catch((e) => setError(String(e)))
    if (tab === 'streak') fetchStreaks().then(setStreaks).catch((e) => setError(String(e)))
  }, [tab, user])

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
          <button className="primary small" onClick={() => void signInWithGoogle()}>
            用 Google 登入
          </button>
        </div>
      ) : error ? (
        <p className="board-empty">排行榜載入失敗：{error}</p>
      ) : tab === 'weekly' ? (
        <WeeklyTable rows={weekly} />
      ) : tab === 'streak' ? (
        <StreakTable rows={streaks} />
      ) : (
        <p className="board-empty">模擬考模式完成後開放。</p>
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
