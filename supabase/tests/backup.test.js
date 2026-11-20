// 雲端備份腳本（supabase/backup.mjs）的純函式。執行：npm run test:db
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { countRows, insideRepo } from '../backup.mjs'

test('data.sql 的筆數：COPY 到 \\. 之間一行一筆；空表是 0 筆；Windows 換行也算得對', () => {
  const sql = [
    'SET session_replication_role = replica;',
    'COPY "auth"."users" ("id", "email") FROM stdin;',
    'u1\ta@users.invalid',
    'u2\tb@users.invalid',
    '\\.',
    '',
    'COPY "public"."reports" ("id") FROM stdin;',
    '\\.',
    'COPY "public"."question_marks" ("question_id", "note") FROM stdin;\r',
    '115090_1_001\t第一行\\n第二行\r', // 資料裡的換行在 COPY 格式是跳脫過的 \n，不會拆成兩行
    '\\.\r',
  ].join('\n')
  assert.deepEqual([...countRows(sql)], [['auth.users', 2], ['public.reports', 0], ['public.question_marks', 1]])
})

test('備份資料夾不能在 repo 裡面', () => {
  const root = path.resolve('/repo')
  assert.equal(insideRepo(path.join(root, 'backups', 'x'), root), true)
  assert.equal(insideRepo(root, root), true)
  assert.equal(insideRepo(path.resolve('/home/roger/nmle-backups/x'), root), false)
  assert.equal(insideRepo(path.resolve('/repo-backups/x'), root), false) // 名稱開頭一樣，但不在 repo 裡
})
