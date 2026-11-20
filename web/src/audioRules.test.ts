// 聲音的規則。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseBgm, DEFAULT_AUDIO, giftVoiceId, normalizeAudio, voiceKeys } from './audioRules.ts'

test('設定：預設靜音；壞掉或超出範圍的值改回預設或夾在 0–1', () => {
  assert.equal(DEFAULT_AUDIO.enabled, false)
  assert.deepEqual(normalizeAudio(null), DEFAULT_AUDIO)
  assert.deepEqual(normalizeAudio({ enabled: true, bgm: 2, sfx: -1, voice: 'x' }), { enabled: true, bgm: 1, sfx: 0, voice: DEFAULT_AUDIO.voice })
})

const base = { characterMode: true, mockRunning: false, story: null, onMap: false, runKind: null, runCharacter: null }

test('BGM：一般模式、模擬考作答中不放', () => {
  assert.equal(chooseBgm({ ...base, characterMode: false, onMap: true }), null)
  assert.equal(chooseBgm({ ...base, mockRunning: true, onMap: true }), null)
})

test('BGM：地圖、和學姊讀書、錯題複習、劇情各有曲目', () => {
  assert.equal(chooseBgm({ ...base, onMap: true }), 'map')
  assert.equal(chooseBgm({ ...base, runKind: 'character', runCharacter: 'fei' }), 'theme_fei')
  assert.equal(chooseBgm({ ...base, runKind: 'review' }), 'library')
  assert.equal(chooseBgm({ ...base, runKind: 'paper' }), 'map')
  assert.equal(chooseBgm({ ...base, onMap: true, story: { character: 'ying' } }), 'theme_ying')
  assert.equal(chooseBgm({ ...base, story: { character: 'ying', bgm: 'festival' } }), 'festival')
})

test('語音：先找學弟／學妹的版本，再找共用的', () => {
  assert.deepEqual(voiceKeys('fei-correct-001', '學妹'), ['fei-correct-001.f', 'fei-correct-001'])
})

test('收禮台詞有 {gift} 的，每種禮物各一個語音檔；沒有的用台詞 id', () => {
  assert.equal(giftVoiceId({ id: 'fei-gift-001', text: '{gift}？……喔，謝謝。' }, 'latte'), 'fei-gift-001.latte')
  assert.equal(giftVoiceId({ id: 'fei-gift-002', text: '送我的？' }, 'latte'), 'fei-gift-002')
  assert.deepEqual(voiceKeys('fei-gift-001.latte', '學弟'), ['fei-gift-001.latte.m', 'fei-gift-001.latte'])
})
