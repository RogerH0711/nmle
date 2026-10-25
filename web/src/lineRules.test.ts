// 挑台詞：好感度上下限、rare 的權重、知識台詞只在對到題目時出現。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Line } from './characters.ts'
import { eligible, fillAway, lineWeight, matchesTopic, pickLine, RARE_WEIGHT } from './lineRules.ts'

const line = (id: string, o: Partial<Line> = {}): Line => ({
  id, situation: 'correct', affection_min: 0, expression: 'normal', text: id, ...o,
})

// 依序回傳給定的數字，用來控制隨機
const seq = (...xs: number[]) => () => xs.shift() ?? 0

test('好感度：affection_max 以後不再出現，沒寫就不設上限', () => {
  const cold = line('cold', { affection_max: 0 })
  const any = line('any')
  assert.ok(eligible(cold, 0))
  assert.ok(!eligible(cold, 1))
  assert.ok(eligible(any, 5))
  assert.ok(!eligible(line('late', { affection_min: 3 }), 2))
  const lines = [cold, any]
  for (let i = 0; i < 20; i++) assert.equal(pickLine(lines, 'correct', 2)?.id, 'any')
})

test('權重：rare 是一般的三分之一，剛升到的這一階稍微優先', () => {
  assert.equal(lineWeight(line('r', { rare: true }), 1) / lineWeight(line('n'), 1), RARE_WEIGHT)
  assert.ok(lineWeight(line('now', { affection_min: 2 }), 2) > lineWeight(line('old'), 2))
  // 一般 1、rare 1/3，總和 4/3：一般佔 0–1、rare 佔 1–4/3，所以 random 要大於 0.75 才會抽到 rare
  const lines = [line('n'), line('r', { rare: true })]
  assert.equal(pickLine(lines, 'correct', 1, null, '', seq(0.8))?.id, 'r')
  assert.equal(pickLine(lines, 'correct', 1, null, '', seq(0.7))?.id, 'n')
})

test('知識台詞：沒對到題目就不會出現；對到時一半機會優先說', () => {
  const k = line('k', { keywords: ['凋亡', 'Apoptosis'] })
  const n = line('n')
  const lines = [k, n]
  assert.ok(matchesTopic(k, '下列關於 apoptosis 的敘述'), '英文不分大小寫')
  assert.ok(!matchesTopic(k, '壞死的型態'))
  for (let i = 0; i < 20; i++) assert.equal(pickLine(lines, 'correct', 0, null, '壞死的型態')?.id, 'n')
  assert.equal(pickLine(lines, 'correct', 0, null, '細胞凋亡', seq(0.4, 0))?.id, 'k')
  assert.equal(pickLine(lines, 'correct', 0, null, '細胞凋亡', seq(0.6, 0))?.id, 'n')
  assert.equal(pickLine(lines, 'correct', 0, null, '')?.id, 'n', '沒有題目（開場、結束）時不會說知識台詞')
})

test('不和上一句重複（只剩一句時例外）', () => {
  const lines = [line('a'), line('b')]
  for (let i = 0; i < 20; i++) assert.equal(pickLine(lines, 'correct', 0, 'a')?.id, 'b')
  assert.equal(pickLine([line('a')], 'correct', 0, 'a')?.id, 'a')
})

test('知識台詞的一組關鍵字要全部出現才算對到', () => {
  const k = line('k', { keywords: [['病毒', '核糖體'], 'ribosome'] })
  assert.ok(matchesTopic(k, '病毒沒有核糖體'))
  assert.ok(!matchesTopic(k, '核糖體的次單元'), '只有核糖體、沒有病毒不算')
  assert.ok(matchesTopic(k, 'free Ribosome'), '單一的字照舊')
})

test('久沒上線：{days}、{hours}、{minutes} 代入離上次作答多久', () => {
  const ms = (72 * 60 + 14) * 60_000
  assert.equal(fillAway('{hours} 小時又 {minutes} 分鐘', ms), '72 小時又 14 分鐘')
  assert.equal(fillAway('{days} 天', ms), '3 天')
  assert.equal(fillAway('沒有代入欄位', ms), '沒有代入欄位')
})

test('night 的台詞只在晚上（18 點到 5 點）出現', () => {
  const lines = [line('day'), line('night', { night: true })]
  for (let i = 0; i < 20; i++) assert.equal(pickLine(lines, 'correct', 0, null, '', Math.random, 12)?.id, 'day')
  assert.equal(pickLine(lines, 'correct', 0, 'day', '', Math.random, 23)?.id, 'night')
  assert.equal(pickLine(lines, 'correct', 0, 'day', '', Math.random, 3)?.id, 'night')
  assert.ok(eligible(line('n', { night: true }), 0), '沒給時段（送禮）就不看')
})
