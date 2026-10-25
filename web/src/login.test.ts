// 帳號密碼登入的帳號名稱規則。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authErrorText, normalizeUsername, passwordError, usernameEmail, usernameError, usernameOf } from './login.ts'

test('帳號名稱：轉小寫、去空白，只接受英數和底線', () => {
  assert.equal(normalizeUsername('  Roger_01 '), 'roger_01')
  assert.equal(usernameError('roger_01'), null)
  assert.match(usernameError('ab')!, /3–20/)
  assert.match(usernameError('a'.repeat(21))!, /3–20/)
  assert.match(usernameError('學弟123')!, /英文字母/)
  assert.match(usernameError('a@b.com')!, /英文字母/)
})

test('帳號名稱和假 Email 互轉；Google 帳號不算', () => {
  assert.equal(usernameEmail('roger_01'), 'roger_01@users.invalid')
  assert.equal(usernameOf('roger_01@users.invalid'), 'roger_01')
  assert.equal(usernameOf('someone@gmail.com'), null)
  assert.equal(usernameOf(undefined), null)
})

test('密碼至少 8 個字元，不超過 bcrypt 的 72 bytes', () => {
  assert.match(passwordError('1234567')!, /8/)
  assert.equal(passwordError('12345678'), null)
  assert.equal(passwordError('a'.repeat(72)), null)
  assert.ok(passwordError('密'.repeat(25))) // 中文一個字 3 bytes，75 bytes
})

test('Supabase 錯誤代碼轉成中文訊息', () => {
  assert.equal(authErrorText({ code: 'invalid_credentials', message: '' }, 'signin'), '帳號名稱或密碼不對')
  assert.match(authErrorText({ code: 'user_already_exists', message: '' }, 'signup'), /有人用了/)
  assert.match(authErrorText({ message: 'Failed to fetch' }, 'signin'), /網路/)
  assert.equal(authErrorText({ code: 'unexpected_failure', message: 'Database error saving new user' }, 'signup'), '註冊失敗，請再試一次')
})
