// 備份與搬家（backup.ts）。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBackup, countAnswers, mergeBackup, parseBackup } from './backup.ts'
import { decodeAnswers, encodeAnswers, type StoredAnswer } from './answerStorage.ts'

const answer = (id: string, at: string, synced = false): StoredAnswer => ({
  id, question_id: '115090_1_062', picked: 'C', correct: true, answered_at: at, synced,
})
const A = 'nmle.answers.v2.anon'

test('只匯出網站的紀錄：不帶登入權杖、裝置代碼、使用統計、同步游標', () => {
  const b = buildBackup({
    [A]: encodeAnswers([answer('a', '2026-11-16T01:00:00.000Z')]),
    'nmle.player.v1': 'junior',
    'nmle.device.v1': 'x',
    'nmle.usage.v1': '{}',
    'nmle.answers.cursor.v1.u1': '{}',
    'sb-gppcwxkhkzfogdfudebu-auth-token': 'secret',
    other: '1',
  })
  assert.deepEqual(Object.keys(b.data).sort(), [A, 'nmle.player.v1'])
  assert.equal(countAnswers(b), 1)
})

test('新瀏覽器：全部寫進去', () => {
  const b = buildBackup({ [A]: encodeAnswers([answer('a', '2026-11-16T01:00:00.000Z')]), 'nmle.player.v1': 'junior' })
  assert.deepEqual(mergeBackup({}, b), b.data)
})

test('作答依 id 合併，重複匯入不會多出來', () => {
  const old = [answer('a', '2026-11-16T01:00:00.000Z')]
  const b = buildBackup({ [A]: encodeAnswers([...old, answer('b', '2026-11-16T02:00:00.000Z')]) })
  const writes = mergeBackup({ [A]: encodeAnswers([...old, answer('c', '2026-11-16T03:00:00.000Z')]) }, b)
  assert.deepEqual(decodeAnswers(writes[A]).map((r) => r.id), ['a', 'b', 'c'])
  assert.deepEqual(mergeBackup({ [A]: writes[A] }, b), {}) // 再匯入一次：沒有要改的
})

test('模擬考、送禮依 id 合併；看過的劇情取聯集', () => {
  const mock = (id: string) => ({ id, paper_id: '115090_1', started_at: `2026-11-1${id}T00:00:00.000Z`, synced: false })
  const b = buildBackup({
    'nmle.mocks.v1.anon': JSON.stringify([mock('1'), mock('2')]),
    'nmle.story.seen.v1': JSON.stringify(['fei-0', 'fei-1']),
  })
  const writes = mergeBackup(
    { 'nmle.mocks.v1.anon': JSON.stringify([mock('3')]), 'nmle.story.seen.v1': JSON.stringify(['ying-0']) },
    b,
  )
  assert.deepEqual(JSON.parse(writes['nmle.mocks.v1.anon']).map((m: { id: string }) => m.id), ['1', '2', '3'])
  assert.deepEqual(JSON.parse(writes['nmle.story.seen.v1']).sort(), ['fei-0', 'fei-1', 'ying-0'])
})

test('設定：這台裝置已經有的不覆蓋', () => {
  const b = buildBackup({ 'nmle.player.v1': 'junior', 'nmle.audio.v1': '{"enabled":true}' })
  assert.deepEqual(mergeBackup({ 'nmle.player.v1': 'senior' }, b), { 'nmle.audio.v1': '{"enabled":true}' })
})

test('讀檔：不是備份檔、或新版網站的備份檔要擋下', () => {
  assert.throws(() => parseBackup('not json'), /不是備份檔/)
  assert.throws(() => parseBackup('{"app":"other","data":{}}'), /不是這個網站/)
  assert.throws(() => parseBackup('{"app":"nmle","version":99,"data":{}}'), /新版/)
  assert.equal(parseBackup(JSON.stringify(buildBackup({}))).app, 'nmle')
})
