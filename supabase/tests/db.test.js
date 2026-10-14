// 資料庫測試：權限（Row Level Security）、作答判分、暱稱、排行榜。
// 執行：npm run test:db
import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { answer, applyMigration, applySeed, as, createDb, createUser, migrations, tryAs } from './helpers.js'

const ROGER = '11111111-1111-4111-8111-111111111111' // 排行榜上線前就登入過的使用者
const A = '22222222-2222-4222-8222-222222222222'
const B = '33333333-3333-4333-8333-333333333333'

let db
let keys // 只有單一正解、非送分的題目，用來造作答資料

before(async () => {
  db = await createDb()
  // 先套第一個 migration，造一筆「舊版就存在」的使用者與作答，再套其餘的 migration 和正解
  await applyMigration(db, migrations[0])
  await createUser(db, ROGER, 'Roger Yang')
  await as(
    db,
    ROGER,
    `insert into public.answers (id, question_id, picked, correct, answered_at)
     values ('aaaaaaaa-0000-4000-8000-000000000001', '115090_1_001', 'A', true, now() - interval '1 hour')`,
  )
  for (const file of migrations.slice(1)) await applyMigration(db, file)
  await applySeed(db)
  await createUser(db, A, '真名甲')
  await createUser(db, B, '真名乙')
  keys = (
    await db.query(
      `select question_id, answers[1] as a from public.question_keys
       where not free_point and cardinality(answers) = 1 order by question_id limit 80`,
    )
  ).rows
})

describe('正解匯入與重新判分', () => {
  test('正解表有題目', async () => {
    const r = await db.query(`select count(*)::int as n from public.question_keys`)
    assert.ok(r.rows[0].n > 2000, `只有 ${r.rows[0].n} 題`)
  })

  test('匯入正解前就同步上來的作答會被重新判分', async () => {
    // 115090_1_001 正解是 C；舊紀錄選 A 卻宣稱答對
    const r = await db.query(`select correct, graded from public.answers where id = 'aaaaaaaa-0000-4000-8000-000000000001'`)
    assert.deepEqual(r.rows[0], { correct: false, graded: true })
  })
})

describe('作答由資料庫判分', () => {
  test('答對但前端送 false，資料庫改成 true', async () => {
    assert.deepEqual(await answer(db, A, '115090_1_001', 'C', false), { correct: true, graded: true })
  })

  test('答錯但前端送 true，資料庫改成 false', async () => {
    assert.deepEqual(await answer(db, A, '115090_1_002', 'A', true), { correct: false, graded: true })
  })

  test('一題多解：115090_1_063 選 B 或 D 都算對', async () => {
    assert.equal((await answer(db, A, '115090_1_063', 'D', false)).correct, true)
  })

  test('一律給分：115090_1_066 任何選項都算對', async () => {
    assert.equal((await answer(db, A, '115090_1_066', 'A', false)).correct, true)
  })

  test('沒有正解的題目：收下但不列入排行榜', async () => {
    assert.equal((await answer(db, A, '999999_1_001', 'A', true)).graded, false)
  })

  test('題目 id 格式不對會被拒絕', async () => {
    await assert.rejects(answer(db, A, 'not-a-question', 'A'))
  })
})

describe('權限', () => {
  test('登入者和未登入者都讀不到正解表', async () => {
    for (const user of [A, null]) {
      const t = await tryAs(db, user, `select * from public.question_keys limit 1`)
      assert.ok(!t.ok || t.res.rows.length === 0, `${user ?? '未登入'} 讀到了正解`)
    }
  })

  test('登入者不能新增或修改正解', async () => {
    assert.equal((await tryAs(db, A, `insert into public.question_keys values ('115090_1_001', '{A}', false)`)).ok, false)
    const t = await tryAs(db, A, `update public.question_keys set answers = '{A}'`)
    assert.ok(!t.ok || t.res.affectedRows === 0)
  })

  test('不能修改或刪除作答紀錄（只增不改）', async () => {
    for (const sql of [`update public.answers set correct = true`, `delete from public.answers`]) {
      const t = await tryAs(db, A, sql)
      assert.ok(!t.ok || t.res.affectedRows === 0, sql)
    }
  })

  test('看不到別人的作答', async () => {
    const r = await as(db, B, `select count(*)::int as n from public.answers where user_id <> $1`, [B])
    assert.equal(r.rows[0].n, 0)
  })

  test('不能替別人新增作答', async () => {
    const t = await tryAs(
      db,
      A,
      `insert into public.answers (id, user_id, question_id, picked, correct, answered_at)
       values ('cccccccc-0000-4000-8000-000000000001', $1, '115090_1_001', 'C', true, now())`,
      [B],
    )
    assert.equal(t.ok, false)
  })

  test('未登入不能讀寫作答紀錄', async () => {
    assert.equal((await as(db, null, `select count(*)::int as n from public.answers`)).rows[0].n, 0)
    assert.equal((await tryAs(db, null, `insert into public.answers (id, question_id, picked, correct, answered_at)
      values ('cccccccc-0000-4000-8000-000000000002', '115090_1_001', 'C', true, now())`)).ok, false)
  })

  test('未登入不能看排行榜', async () => {
    assert.equal((await tryAs(db, null, `select * from public.leaderboard_weekly()`)).ok, false)
    assert.equal((await tryAs(db, null, `select * from public.leaderboard_streaks()`)).ok, false)
  })
})

describe('暱稱', () => {
  test('新使用者的預設暱稱不是 Google 真名', async () => {
    const r = await db.query(`select display_name from public.profiles where id = $1`, [A])
    assert.match(r.rows[0].display_name, /^同學[0-9A-F]{4}$/)
  })

  test('排行榜上線前的使用者暱稱維持原樣', async () => {
    const r = await db.query(`select display_name from public.profiles where id = $1`, [ROGER])
    assert.equal(r.rows[0].display_name, 'Roger Yang')
  })

  test('可以改自己的暱稱、不能改別人的', async () => {
    const mine = await as(db, A, `update public.profiles set display_name = '小甲' where id = $1 returning display_name`, [A])
    assert.equal(mine.rows[0].display_name, '小甲')
    const other = await tryAs(db, A, `update public.profiles set display_name = '駭客' where id = $1`, [B])
    assert.ok(!other.ok || other.res.affectedRows === 0)
  })

  test('暱稱長度限制 1–30 字', async () => {
    assert.equal((await tryAs(db, A, `update public.profiles set display_name = '' where id = $1`, [A])).ok, false)
    assert.equal((await tryAs(db, A, `update public.profiles set display_name = repeat('長', 31) where id = $1`, [A])).ok, false)
  })
})

describe('排行榜', () => {
  let weekly

  before(async () => {
    // A：本週 60 題，前 45 題答對、後 15 題答錯，答錯的同一天又全部重做答對
    for (let i = 0; i < 60; i++) {
      const pick = i < 45 ? keys[i].a : keys[i].a === 'A' ? 'B' : 'A'
      await answer(db, A, keys[i].question_id, pick, true, `${i} seconds`)
    }
    for (let i = 45; i < 60; i++) await answer(db, A, keys[i].question_id, keys[i].a, true, '0 seconds')
    // B：本週只有 20 題全對（未達門檻）；另有一筆上週的作答
    for (let i = 0; i < 20; i++) await answer(db, B, keys[i].question_id, keys[i].a, true, `${i} seconds`)
    await answer(db, B, keys[70].question_id, keys[70].a, true, '8 days')
    weekly = (await as(db, A, `select * from public.leaderboard_weekly(50)`)).rows
  })

  test('週榜：達門檻的排前面，並標出自己', () => {
    assert.ok(weekly[0].is_me && weekly[0].qualified)
  })

  test('週榜：同一題同一天只算第一次，重做錯題不會刷高正確率', () => {
    const me = weekly.find((r) => r.is_me)
    // A 的不重複（題目, 天）：前面判分測試的 4 題（001 對、002 錯、063 對、066 對）＋ 60 題（45 對）
    assert.equal(me.answered, 64)
    assert.equal(me.correct, 48)
  })

  test('週榜：未達 50 題不排名', () => {
    const b = weekly.find((r) => !r.is_me && r.answered === 20)
    assert.ok(b && !b.qualified)
  })

  test('排行榜不回傳 user id', () => {
    assert.ok(!('user_id' in weekly[0]))
  })

  test('連續天數：今天往前算，中間斷一天就重算', async () => {
    // B：前 1–3 天每天 10 題（加上今天 20 題 → 連續 4 天）；前 5–6 天的另一段不算
    for (const day of [1, 2, 3, 5, 6]) {
      for (let i = 0; i < 10; i++) await answer(db, B, keys[i].question_id, keys[i].a, true, `${day} days`)
    }
    const rows = (await as(db, B, `select * from public.leaderboard_streaks(10)`)).rows
    assert.equal(rows.find((r) => r.is_me)?.streak, 4)
    assert.ok(rows.some((r) => !r.is_me && r.streak === 1), 'A 今天有作答，應該是連續 1 天')
  })

  test('連續天數：一天不到 10 題不算', async () => {
    const C = '44444444-4444-4444-8444-444444444444'
    await createUser(db, C, '真名丙')
    for (let i = 0; i < 9; i++) await answer(db, C, keys[i].question_id, keys[i].a, true, `${i} seconds`)
    const rows = (await as(db, C, `select * from public.leaderboard_streaks(10)`)).rows
    assert.ok(!rows.some((r) => r.is_me))
  })
})
