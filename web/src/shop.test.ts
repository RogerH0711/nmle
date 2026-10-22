// 禮物商店：書籤的推算、送禮對好感度的加成。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { affection, GOALS, subjectMap } from './affection.ts'
import type { AnswerRecord } from './answers.ts'
import type { Line } from './characters.ts'
import { balance, EARN, earnings, giftBonus, giftPoints, givenToday, isGiftRecord, pickGiftLine, type GiftCatalog } from './shop.ts'

const map = subjectMap([{ id: 'p_1', subject_runs: [[1, 50, 'pathology'], [51, 100, 'pharmacology']] }])
const FEI = ['pathology']

let seq = 0
const at = (day: string, minute = 0) => new Date(`${day}T10:${String(minute).padStart(2, '0')}:00`).toISOString()
const rec = (n: number, correct: boolean, answered_at = at('2026-10-14')): AnswerRecord => ({
  id: String(seq++),
  question_id: `p_1_${String(n).padStart(3, '0')}`,
  picked: 'A',
  correct,
  answered_at,
  synced: false,
})

const catalog: GiftCatalog = {
  gifts: [
    { id: 'latte', name: '拿鐵', icon: '☕', price: 20, description: '' },
    { id: 'cake', name: '蛋糕', icon: '🍰', price: 60, description: '' },
  ],
  likes: { fei: ['cake'] },
}

test('書籤：同一題答對很多次只算一次，答錯不算', () => {
  const records = [rec(1, true), rec(1, true), rec(1, true), rec(2, false)]
  assert.deepEqual(earnings(records), { firstCorrect: 1, reviewPasses: 0, studyDays: 0, total: EARN.firstCorrect })
})

test('書籤：錯題按時複習答對、一天寫滿 10 題都有', () => {
  const day1 = Array.from({ length: 10 }, (_, i) => rec(i + 1, i > 0, at('2026-10-14', i))) // 第 1 題答錯
  const day2 = [rec(1, true, at('2026-10-15'))] // 隔天到期，按時答對
  const e = earnings([...day1, ...day2])
  assert.equal(e.firstCorrect, 10)
  assert.equal(e.reviewPasses, 1)
  assert.equal(e.studyDays, 1)
  assert.equal(e.total, 10 * EARN.firstCorrect + EARN.reviewPass + EARN.studyDay)
})

test('餘額：賺到的減掉送出去的禮物價格', () => {
  const records = Array.from({ length: 30 }, (_, i) => rec(i + 1, true, at('2026-10-14', i)))
  const earned = earnings(records).total
  assert.equal(balance(records, [{ price: 20 }, { price: 60 }]), earned - 80)
})

test('一天只能送同一位學姊一次，別的學姊不受影響', () => {
  const gifts = [{ character_id: 'fei', given_at: at('2026-10-14') }]
  assert.equal(givenToday(gifts, 'fei', '2026-10-14'), true)
  assert.equal(givenToday(gifts, 'fei', '2026-10-15'), false)
  assert.equal(givenToday(gifts, 'yiqing', '2026-10-14'), false)
})

test('買服裝：書籤照扣，但不加心意點數（好感度只靠讀書和禮物）', () => {
  const records = Array.from({ length: 30 }, (_, i) => rec(i + 1, true, at('2026-10-14', i)))
  const gifts = [
    { character_id: 'fei', gift_id: 'cake', stage: 0, price: 60 },
    { character_id: 'fei', gift_id: 'fei_dress', stage: 0, price: 600 }, // 服裝 id 不在 gifts.json
  ]
  assert.equal(balance(records, gifts), earnings(records).total - 660)
  assert.deepEqual(giftPoints(catalog, gifts, 'fei'), [{ stage: 0, points: 2 }])
  assert.deepEqual(gifts.filter((g) => isGiftRecord(catalog, g)).map((g) => g.gift_id), ['cake'])
})

test('心意點數：她喜歡的禮物算 2 點，別人收到的不算', () => {
  const gifts = [
    { character_id: 'fei', gift_id: 'cake', stage: 0 },
    { character_id: 'fei', gift_id: 'latte', stage: 0 },
    { character_id: 'yiqing', gift_id: 'cake', stage: 0 },
  ]
  assert.deepEqual(giftPoints(catalog, gifts, 'fei'), [{ stage: 0, points: 2 }, { stage: 0, points: 1 }])
})

test('加成：每點抵目標 5%，最多 20%', () => {
  assert.equal(giftBonus(0, 30), 0)
  assert.equal(giftBonus(2, 30), 3)
  assert.equal(giftBonus(4, 30), 6)
  assert.equal(giftBonus(10, 30), 6)
  assert.equal(giftBonus(1, 10), 1) // 在意的目標小，第一份禮物也要有感
  assert.equal(giftBonus(10, 10), 2)
})

test('好感度：初識時送的禮物抵熟識的題數，最多 20%', () => {
  const records = Array.from({ length: 24 }, (_, i) => rec(i + 1, true))
  assert.equal(affection(FEI, records, [], map).stage, 0)
  const two = affection(FEI, records, [], map, [{ stage: 0, points: 2 }])
  assert.equal(two.stage, 0)
  assert.deepEqual(two.next && [two.next.current, two.next.bonus], [27, 3])
  const many = affection(FEI, records, [], map, Array.from({ length: 10 }, () => ({ stage: 0, points: 2 })))
  assert.equal(many.stage, 1) // 24 + 6 = 30
  const fewer = affection(FEI, records.slice(0, 23), [], map, Array.from({ length: 10 }, () => ({ stage: 0, points: 2 })))
  assert.equal(fewer.stage, 0) // 23 + 6 < 30：禮物不能取代讀書
})

test('好感度：熟識時送的禮物只抵在意，不會回頭算熟識', () => {
  const records = Array.from({ length: GOALS.correct }, (_, i) => rec(i + 1, true))
  const a = affection(FEI, records, [], map, [{ stage: 1, points: 2 }])
  assert.equal(a.stage, 1)
  assert.deepEqual(a.next && [a.next.current, a.next.bonus], [1, 1])
})

test('好感度：在意之後送禮沒有加成（心動、告白前夕看正確率和模擬考）', () => {
  const records = Array.from({ length: 24 }, (_, i) => rec(i + 1, true))
  const a = affection(FEI, records, [], map, [{ stage: 2, points: 2 }, { stage: 3, points: 2 }])
  assert.equal(a.next?.current, 24)
})

test('收禮台詞：她喜歡的用專屬的一句，其他用一般的', () => {
  const lines: Line[] = [
    { id: 'g', situation: 'gift', affection_min: 0, expression: 'normal', text: '謝謝{gift}' },
    { id: 'l', situation: 'gift_liked', affection_min: 0, expression: 'happy', gift: 'cake', text: '蛋糕！' },
  ]
  assert.equal(pickGiftLine(lines, 'cake', true, 0)?.id, 'l')
  assert.equal(pickGiftLine(lines, 'latte', false, 0)?.id, 'g')
  assert.equal(pickGiftLine(lines, 'latte', true, 0)?.id, 'g') // 喜歡但沒有專屬台詞
})
