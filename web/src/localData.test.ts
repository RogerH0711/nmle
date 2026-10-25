// 刪除帳號時清掉哪些本機紀錄。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keysToClearOnDelete } from './localData.ts'

test('刪除帳號：清掉這個帳號的紀錄和裝置上的進度，設定和別人的紀錄留著', () => {
  const me = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const keys = [
    `nmle.answers.v2.${me}`, `nmle.answers.v1.${me}`, `nmle.mocks.v1.${me}`, `nmle.gifts.v1.${me}`, `nmle.outfits.v1.${me}`,
    'nmle.run.v2', 'nmle.mock.session.v1', 'nmle.story.seen.v1', 'nmle.messages.v1', 'nmle.reports.sent.v1', 'nmle.player.v1',
    `nmle.answers.v2.${other}`, 'nmle.answers.v2.anon', 'nmle.characterMode', 'nmle.audio.v1', 'nmle.device.v1',
    'nmle.usage.v1', 'nmle.reports.pending.v1', `sb-gppcwxkhkzfogdfudebu-auth-token`,
  ]
  assert.deepEqual(keysToClearOnDelete(keys, me), keys.slice(0, 11))
})
