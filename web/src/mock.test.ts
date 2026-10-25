// 模擬考的計分與計時規則（要和資料庫的 leaderboard_mock 一致）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestCharacter, firstAttempts, formatClock, mockQueue, scoreMock, submitTime, tooQuick, type MockRecord } from './mock.ts'
import type { Letter, Question } from './types.ts'

const q = (number: number, subject: string, answers: Letter[], extra: Partial<Question> = {}): Question => ({
  id: `115090_1_${String(number).padStart(3, '0')}`,
  number,
  subject,
  subject_status: 'range',
  stem: '',
  options: ['', '', '', ''],
  answers,
  free_point: false,
  answer_note: null,
  override_reason: null,
  images: [],
  explanation: null,
  explanation_status: 'none',
  valid: true,
  issues: [],
  ...extra,
})

const paper = [
  q(1, 'anatomy', ['A']),
  q(2, 'anatomy', ['B', 'D']), // 一題多解
  q(3, 'physiology', ['A', 'B', 'C', 'D'], { free_point: true }), // 一律給分
  q(4, 'physiology', ['A', 'B', 'C', 'D'], { free_point: true, valid: false }), // 沒出題但給分
  q(5, 'physiology', ['C'], { valid: false }), // 解析有問題、沒出題也沒給分
]

test('計分：一題多解選到其中一個就對；送分題沒作答也給分', () => {
  const s = scoreMock(paper, { '115090_1_001': 'B', '115090_1_002': 'D' })
  assert.equal(s.score, 3) // 第 2、3、4 題
  assert.equal(s.total, 4) // 第 5 題不算進滿分
  assert.equal(s.answered, 2)
})

test('計分：沒出題的送分題只加總分，不列進學科', () => {
  const s = scoreMock(paper, {})
  assert.deepEqual(s.bySubject.get('physiology'), { total: 1, correct: 1 })
  assert.deepEqual(s.bySubject.get('anatomy'), { total: 2, correct: 0 })
})

test('出題順序：只出可作答的題目，依題號排列', () => {
  assert.deepEqual(mockQueue([paper[2], paper[0], paper[4], paper[1]]), ['115090_1_001', '115090_1_002', '115090_1_003'])
})

test('交卷時間：時間到之後才交，算在時間到的那一刻', () => {
  const start = '2026-10-15T01:00:00.000Z'
  assert.equal(submitTime(start, Date.parse('2026-10-15T02:30:00Z')), '2026-10-15T02:30:00.000Z')
  assert.equal(submitTime(start, Date.parse('2026-10-16T09:00:00Z')), '2026-10-15T03:00:00.000Z')
})

test('倒數顯示', () => {
  assert.equal(formatClock(2 * 3600_000), '2:00:00')
  assert.equal(formatClock(3909_000), '1:05:09')
  assert.equal(formatClock(299_001), '5:00') // 不足一秒進位，倒數到 0 才是真的時間到
  assert.equal(formatClock(-5000), '0:00')
})

test('作答不到 10 分鐘就交卷不列入排行榜', () => {
  assert.equal(tooQuick({ started_at: '2026-10-25T00:00:00Z', submitted_at: '2026-10-25T00:09:59Z' }), true)
  assert.equal(tooQuick({ started_at: '2026-10-25T00:00:00Z', submitted_at: '2026-10-25T00:10:00Z' }), false)
})

test('每份考卷只有第一次模擬考列入排行榜', () => {
  const r = (id: string, paper_id: string, started_at: string): MockRecord => ({
    id, paper_id, started_at, submitted_at: started_at, picks: {}, synced: true,
  })
  const ids = firstAttempts([
    r('b', '115090_1', '2026-10-16T00:00:00Z'),
    r('a', '115090_1', '2026-10-15T00:00:00Z'),
    r('c', '115090_2', '2026-10-17T00:00:00Z'),
  ])
  assert.deepEqual([...ids].sort(), ['a', 'c'])
})

test('高分時由負責學科得分率最高的角色說話，不是題數最多的', () => {
  const jingcheng = { id: 'jingcheng', subjects: ['anatomy'] }
  const yiqing = { id: 'yiqing', subjects: ['physiology'] }
  const fei = { id: 'fei', subjects: ['pathology'] } // 這份考卷沒有她的學科
  const qs = [
    q(1, 'anatomy', ['A']),
    q(2, 'anatomy', ['A']),
    q(3, 'physiology', ['A']),
    q(4, 'physiology', ['A']),
    q(5, 'physiology', ['A']),
  ]
  const all = (ids: number[]) => Object.fromEntries(ids.map((n) => [`115090_1_00${n}`, 'A' as Letter]))
  // 解剖 2/2、生理 2/3：題數較少的沈靜澄得分率較高
  assert.equal(bestCharacter(qs, all([1, 2, 3, 4]), [yiqing, jingcheng, fei])?.id, 'jingcheng')
  // 都全對：得分率一樣，選題數多的
  assert.equal(bestCharacter(qs, all([1, 2, 3, 4, 5]), [jingcheng, yiqing, fei])?.id, 'yiqing')
  // 沒有任何角色負責這份考卷的學科
  assert.equal(bestCharacter(qs, {}, [fei]), undefined)
})
