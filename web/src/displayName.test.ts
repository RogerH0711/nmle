// 暱稱規則。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayNameError, NAME_MAX } from './displayName.ts'

test('暱稱 1\u201330 個字，emoji 算一個字', () => {
  assert.equal(displayNameError('小甲'), null)
  assert.equal(displayNameError('同學A1B2'), null)
  assert.match(displayNameError('')!, /1\u201330/)
  assert.equal(displayNameError('😀'.repeat(NAME_MAX)), null)
  assert.match(displayNameError('長'.repeat(NAME_MAX + 1))!, /1\u201330/)
})

test('暱稱不能有控制字元、零寬字元、方向控制字元', () => {
  for (const c of ['\u202E', '\u200B', '\u2066', '\uFEFF', '\u3164', '\n', '\u0007']) {
    assert.ok(displayNameError(`小${c}甲`), JSON.stringify(c))
  }
  assert.equal(displayNameError('Roger Yang'), null) // 中間的一般空白可以
})
