// 資料庫測試：權限（Row Level Security）、作答判分、暱稱、排行榜、帳號密碼註冊。
// 執行：npm run test:db
import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { answer, applyMigration, applySeed, as, createDb, createUser, migrations, syncedOnTime, tryAs } from './helpers.js'

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

  test('看不到別人的暱稱，只看得到自己的', async () => {
    const r = await as(db, A, `select id from public.profiles`)
    assert.deepEqual(r.rows.map((x) => x.id), [A])
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

  test('週榜：同一題只算本週第一次，重做錯題不會刷高正確率；送分題不算', () => {
    const me = weekly.find((r) => r.is_me)
    // A 的題目：前面判分測試的 001 對、002 錯、063 對（066 是送分題不算）＋ 60 題（45 對）
    assert.equal(me.answered, 63)
    assert.equal(me.correct, 47)
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
    await syncedOnTime(db, B) // 當成每天都有連上網路、當天就同步
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

describe('排行榜防偽造', () => {
  const D = '77777777-7777-4777-8777-000000000001'
  const E = '77777777-7777-4777-8777-000000000002'
  let seq = 0
  const id = () => `77777777-0000-4000-8000-${String(++seq).padStart(12, '0')}`

  before(async () => {
    await createUser(db, D, '真名丁')
    await createUser(db, E, '真名戊')
  })

  test('同步時間由資料庫決定，前端送的會被蓋掉', async () => {
    const r = await as(
      db,
      D,
      `insert into public.answers (id, question_id, picked, correct, answered_at, synced_at)
       values ($1, '115090_1_001', 'C', true, now(), '1990-01-01') returning synced_at > now() - interval '1 minute' as fresh`,
      [id()],
    )
    assert.equal(r.rows[0].fresh, true)
  })

  test('回填 3 天前以前的作答：收下，但不列入連續天數', async () => {
    // 一次請求寫入過去 30 天、每天 10 題（今天沒有作答）
    const rows = []
    for (let d = 4; d <= 30; d++) for (let i = 0; i < 10; i++) rows.push(`('${id()}', '${keys[i].question_id}', '${keys[i].a}', true, now() - interval '${d} days')`)
    await as(db, D, `insert into public.answers (id, question_id, picked, correct, answered_at) values ${rows.join(',')}`)
    const stored = await db.query(`select count(*)::int as n, count(*) filter (where ranked)::int as ranked from public.answers where user_id = $1 and answered_at < now() - interval '3 days'`, [D])
    assert.deepEqual(stored.rows[0], { n: 270, ranked: 0 })
    const rows2 = (await as(db, D, `select * from public.leaderboard_streaks(10)`)).rows
    assert.ok(!rows2.some((r) => r.is_me))
  })

  test('預先寫入未來的作答：不列入排行榜，時間到了也不算', async () => {
    const r = await as(
      db,
      D,
      `insert into public.answers (id, question_id, picked, correct, answered_at)
       values ($1, '115090_1_002', 'B', true, now() + interval '2 days') returning ranked`,
      [id()],
    )
    assert.equal(r.rows[0].ranked, false)
  })

  test('3 天內的離線作答之後才同步，照常列入連續天數', async () => {
    for (const d of [0, 1, 2]) for (let i = 0; i < 10; i++) await answer(db, E, keys[i].question_id, keys[i].a, true, `${d} days`)
    const rows = (await as(db, E, `select * from public.leaderboard_streaks(10)`)).rows
    assert.equal(rows.find((r) => r.is_me)?.streak, 3)
  })

  test('週榜：本週先答錯、之後重做答對，只算第一次（隔天重做也一樣）', async () => {
    const F = '77777777-7777-4777-8777-000000000003'
    await createUser(db, F, '真名己')
    // 本週一開始時答錯 keys[79]，現在重做答對；其餘 50 題答對；再做一題送分題
    const wrong = keys[79].a === 'A' ? 'B' : 'A'
    await as(
      db,
      F,
      `insert into public.answers (id, question_id, picked, correct, answered_at)
       values ($1, $2, $3, false, date_trunc('week', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei' + interval '1 minute')`,
      [id(), keys[79].question_id, wrong],
    )
    await syncedOnTime(db, F)
    await answer(db, F, keys[79].question_id, keys[79].a)
    for (let i = 0; i < 50; i++) await answer(db, F, keys[i].question_id, keys[i].a)
    await answer(db, F, '115090_1_066', 'A')
    const me = (await as(db, F, `select * from public.leaderboard_weekly(50)`)).rows.find((r) => r.is_me)
    assert.deepEqual([me.answered, me.correct], [51, 50])
  })
})

describe('模擬考', () => {
  let mockSeq = 0
  const P = '115090_2' // 有 5 題一律給分、1 題一題多解
  let paperKeys

  /** 以使用者身分交一次模擬考：started 是多久以前開始，minutes 是作答幾分鐘 */
  const submit = (userId, paperId, picks, started = '3 hours', minutes = 100) =>
    tryAs(
      db,
      userId,
      `insert into public.mock_exams (id, paper_id, started_at, submitted_at, picks)
       values ($1, $2, now() - $3::interval, now() - $3::interval + make_interval(mins => $4), $5)`,
      [`dddddddd-0000-4000-8000-${String(++mockSeq).padStart(12, '0')}`, paperId, started, minutes, JSON.stringify(picks)],
    )

  // 前 n 題（不含送分題）答對、其餘答錯；回傳 picks 和預期分數
  const attempt = (n) => {
    const picks = {}
    let score = 0
    let i = 0
    for (const k of paperKeys) {
      if (k.free_point) {
        score++
        continue
      }
      const ok = i++ < n
      picks[k.question_id] = ok ? k.answers[0] : ['A', 'B', 'C', 'D'].find((l) => !k.answers.includes(l))
      if (ok) score++
    }
    return { picks, score }
  }

  const board = async (userId, paper = null) =>
    (await as(db, userId, `select * from public.leaderboard_mock($1)`, [paper])).rows

  before(async () => {
    paperKeys = (
      await db.query(`select question_id, answers, free_point from public.question_keys where question_id like $1 order by 1`, [`${P}_%`])
    ).rows
  })

  test('分數依正解現算：送分題不論有沒有作答都給分，滿分 100', async () => {
    const { picks, score } = attempt(60)
    assert.equal((await submit(A, P, picks)).ok, true)
    const me = (await board(A, P)).find((r) => r.is_me)
    assert.deepEqual([me.score, me.total, me.seconds], [score, 100, 6000])
    assert.equal(score, 65)
  })

  test('沒出題的送分題也算分：114020_1 交白卷得 1 分', async () => {
    assert.equal((await submit(B, '114020_1', {})).ok, true)
    const me = (await board(B, '114020_1')).find((r) => r.is_me)
    assert.deepEqual([me.score, me.total], [1, 100])
  })

  test('同一份考卷只採計第一次', async () => {
    assert.equal((await submit(A, P, attempt(90).picks, '1 hour', 30)).ok, true)
    assert.equal((await board(A, P)).find((r) => r.is_me).score, 65)
  })

  test('不指定考卷：取各考卷第一次中最好的一次，並列出考過幾份', async () => {
    assert.equal((await submit(A, '114020_1', {})).ok, true)
    const me = (await board(A)).find((r) => r.is_me)
    assert.deepEqual([me.paper_id, me.score, me.papers], [P, 65, 2])
  })

  test('同分時用時短的排前面', async () => {
    // B 在 P 考出和 A 一樣的 65 分，但只用 50 分鐘
    assert.equal((await submit(B, P, attempt(60).picks, '3 hours', 50)).ok, true)
    const rows = await board(A, P)
    assert.deepEqual(rows.map((r) => r.is_me), [false, true])
  })

  test('排行榜不回傳 user id 或作答內容', async () => {
    const row = (await board(A))[0]
    assert.ok(!('user_id' in row) && !('picks' in row))
  })

  test('補一筆開始時間更早的模擬考，不會取代第一次', async () => {
    const G = '88888888-8888-4888-8888-000000000001'
    await createUser(db, G, '真名庚')
    assert.equal((await submit(G, P, attempt(10).picks, '1 hour', 30)).ok, true)
    // 開始、交卷都填 2000 年，滿分、0 秒
    const t = await tryAs(
      db,
      G,
      `insert into public.mock_exams (id, paper_id, started_at, submitted_at, picks) values ($1, $2, '2000-01-01', '2000-01-01', $3)`,
      [`dddddddd-0000-4000-8000-${String(++mockSeq).padStart(12, '0')}`, P, JSON.stringify(attempt(95).picks)],
    )
    assert.equal(t.ok, true)
    const me = (await board(G, P)).find((r) => r.is_me)
    assert.deepEqual([me.score, me.seconds], [attempt(10).score, 1800])
  })

  test('第一次的時間不合理（開始時間太舊、不到 10 分鐘交卷）就沒有成績，也不會改採第二次', async () => {
    const H = '88888888-8888-4888-8888-000000000002'
    await createUser(db, H, '真名辛')
    assert.equal((await submit(H, P, attempt(95).picks, '5 days', 100)).ok, true) // 5 天前開始
    assert.equal((await submit(H, P, attempt(95).picks, '1 hour', 30)).ok, true)
    assert.equal((await submit(H, '113020_1', {}, '1 hour', 5)).ok, true) // 5 分鐘就交卷
    assert.ok(!(await board(H)).some((r) => r.is_me))
  })

  test('超過 2 小時交卷會被拒絕', async () => {
    assert.equal((await submit(A, '113020_1', {}, '5 hours', 125)).ok, false)
  })

  test('picks 只能有這份考卷的題目，答案只能是 A–D', async () => {
    assert.equal((await submit(A, '113020_1', { '113020_2_001': 'A' })).ok, false)
    assert.equal((await submit(A, '113020_1', { '113020_1_001': 'E' })).ok, false)
    assert.equal((await submit(A, '113020_1', { '113020_1_1': 'A' })).ok, false)
    assert.equal((await submit(A, '113020_1', ['A'])).ok, false)
  })

  test('看不到別人的模擬考，也不能替別人交', async () => {
    const r = await as(db, B, `select count(*)::int as n from public.mock_exams where user_id <> $1`, [B])
    assert.equal(r.rows[0].n, 0)
    const t = await tryAs(
      db,
      A,
      `insert into public.mock_exams (id, user_id, paper_id, started_at, submitted_at, picks)
       values ('eeeeeeee-0000-4000-8000-000000000001', $1, '113020_1', now() - interval '1 hour', now(), '{}')`,
      [B],
    )
    assert.equal(t.ok, false)
  })

  test('交卷後不能修改或刪除', async () => {
    for (const sql of [`update public.mock_exams set picks = '{}'`, `delete from public.mock_exams`]) {
      const t = await tryAs(db, A, sql)
      assert.ok(!t.ok || t.res.affectedRows === 0, sql)
    }
  })

  test('未登入不能讀寫模擬考，也不能看模擬考排行榜', async () => {
    assert.equal((await as(db, null, `select count(*)::int as n from public.mock_exams`)).rows[0].n, 0)
    assert.equal((await submit(null, '113020_1', {})).ok, false)
    assert.equal((await tryAs(db, null, `select * from public.leaderboard_mock()`)).ok, false)
  })
})

describe('回報疑義', () => {
  let reportSeq = 0
  const DEVICE = 'ffffffff-0000-4000-8000-000000000001'

  /** 以某個身分（null 為未登入）送一筆回報；extra 可以覆寫欄位 */
  const report = (userId, extra = {}) => {
    const row = {
      id: `ffffffff-1111-4000-8000-${String(++reportSeq).padStart(12, '0')}`,
      device_id: `ffffffff-2222-4000-8000-${String(reportSeq).padStart(12, '0')}`, // 預設每筆不同裝置，不會撞到頻率限制
      question_id: '115090_1_001',
      reason: 'answer',
      note: '正解應該是 B',
      ...extra,
    }
    const cols = Object.keys(row)
    return tryAs(
      db,
      userId,
      `insert into public.reports (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => row[c]),
    )
  }
  const stored = async (id) => (await db.query(`select * from public.reports where id = $1`, [id])).rows[0]

  test('沒登入也能回報，user_id 是 null', async () => {
    assert.equal((await report(null, { id: 'ffffffff-3333-4000-8000-000000000001' })).ok, true)
    assert.equal((await stored('ffffffff-3333-4000-8000-000000000001')).user_id, null)
  })

  test('登入時自動帶入 user_id', async () => {
    assert.equal((await report(A, { id: 'ffffffff-3333-4000-8000-000000000002' })).ok, true)
    assert.equal((await stored('ffffffff-3333-4000-8000-000000000002')).user_id, A)
  })

  test('不能冒用別人的 user_id；沒登入也不能填 user_id', async () => {
    assert.equal((await report(A, { user_id: B })).ok, false)
    assert.equal((await report(null, { user_id: B })).ok, false)
  })

  test('處理狀態、備註、建立時間由資料庫決定', async () => {
    const id = 'ffffffff-3333-4000-8000-000000000003'
    const t = await report(null, { id, status: 'fixed', admin_note: '已處理', created_at: '2000-01-01T00:00:00Z' })
    assert.equal(t.ok, true)
    const r = await stored(id)
    assert.equal(r.status, 'open')
    assert.equal(r.admin_note, null)
    assert.ok(new Date(r.created_at).getFullYear() > 2000)
  })

  test('可以回報詳解有誤', async () => {
    assert.equal((await report(null, { reason: 'explanation' })).ok, true)
  })

  test('原因、題目 id、答案、補充說明長度都有檢查', async () => {
    assert.equal((await report(null, { reason: 'spam' })).ok, false)
    assert.equal((await report(null, { question_id: 'x' })).ok, false)
    assert.equal((await report(null, { picked: 'E' })).ok, false)
    assert.equal((await report(null, { note: '長'.repeat(501) })).ok, false)
    assert.equal((await report(null, { note: '長'.repeat(500), picked: 'C', build: '0afa325' })).ok, true)
  })

  test('同一台裝置每分鐘最多 5 筆', async () => {
    const results = []
    for (let i = 0; i < 6; i++) results.push((await report(null, { device_id: DEVICE })).ok)
    assert.deepEqual(results, [true, true, true, true, true, false])
  })

  test('沒有人讀得到、改得到、刪得到回報', async () => {
    for (const user of [A, null]) {
      const r = await tryAs(db, user, `select * from public.reports`)
      assert.ok(!r.ok || r.res.rows.length === 0, `${user ?? '未登入'} 讀到了回報`)
      for (const sql of [`update public.reports set status = 'fixed'`, `delete from public.reports`]) {
        const t = await tryAs(db, user, sql)
        assert.ok(!t.ok || t.res.affectedRows === 0, sql)
      }
    }
  })

  test('匿名回報合計每小時最多 200 筆，登入的人不受影響', async () => {
    const before = (await db.query(`select count(*)::int as n from public.reports where user_id is null`)).rows[0].n
    for (let i = before; i < 200; i++) assert.equal((await report(null)).ok, true, `第 ${i + 1} 筆`)
    const blocked = await report(null)
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /匿名回報太多/)
    assert.equal((await report(B)).ok, true)
  })
})

describe('匿名使用統計', () => {
  const DEV = 'abababab-0000-4000-8000-000000000001'
  const ping = (userId, answered, device = DEV, extra = { cm: true, signed: false, build: 'abc1234' }) =>
    tryAs(db, userId, `select public.ping_usage($1, $2, $3, $4, $5)`, [device, answered, extra.cm, extra.signed, extra.build])
  const row = async (device = DEV) =>
    (await db.query(`select * from public.usage_daily where device_id = $1`, [device])).rows

  test('沒登入也能記錄，同一台裝置同一天只有一筆', async () => {
    assert.equal((await ping(null, 3)).ok, true)
    assert.equal((await ping(null, 8)).ok, true)
    const rows = await row()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].answered, 8)
  })

  test('作答題數只增不減（重送或亂序時舊的數字不會蓋掉新的）', async () => {
    assert.equal((await ping(null, 5)).ok, true)
    assert.equal((await row())[0].answered, 8)
  })

  test('登入過一次就記成有登入；日期由資料庫用台灣時間決定', async () => {
    assert.equal((await ping(A, 9, DEV, { cm: false, signed: true, build: 'x' })).ok, true)
    assert.equal((await ping(null, 9, DEV, { cm: false, signed: false, build: 'x' })).ok, true)
    const r = (await row())[0]
    assert.equal(r.signed_in, true)
    assert.equal(r.character_mode, false)
    const today = (await db.query(`select (now() at time zone 'Asia/Taipei')::date as d`)).rows[0].d
    assert.equal(r.day.toISOString(), today.toISOString())
  })

  test('不記錄 user id：登入時呼叫也連不回是誰', async () => {
    const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'usage_daily'`)).rows.map((c) => c.column_name)
    assert.ok(!cols.includes('user_id'), cols.join(','))
  })

  test('題數超出範圍、沒有裝置代碼會被拒絕', async () => {
    assert.equal((await ping(null, -1)).ok, false)
    assert.equal((await ping(null, 5001)).ok, false)
    assert.equal((await ping(null, 1, null)).ok, false)
  })

  test('沒有人能直接讀寫這張表', async () => {
    for (const user of [A, null]) {
      const r = await tryAs(db, user, `select * from public.usage_daily`)
      assert.ok(!r.ok || r.res.rows.length === 0, `${user ?? '未登入'} 讀到了使用統計`)
      const ins = await tryAs(db, user, `insert into public.usage_daily (device_id, day, character_mode, signed_in) values ($1, current_date, true, true)`, ['cdcdcdcd-0000-4000-8000-000000000001'])
      assert.equal(ins.ok, false)
      for (const sql of [`update public.usage_daily set answered = 4999`, `delete from public.usage_daily`]) {
        const t = await tryAs(db, user, sql)
        assert.ok(!t.ok || t.res.affectedRows === 0, sql)
      }
    }
  })
})

describe('送禮', () => {
  let giftSeq = 0
  const give = (userId, extra = {}) => {
    const g = { character: 'fei', gift: 'strawberry_cake', price: 60, stage: 0, line: 'fei-gift-001', ...extra }
    return tryAs(
      db,
      userId,
      `insert into public.gifts (id, character_id, gift_id, price, stage, line_id, given_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [`fafafafa-0000-4000-8000-${String(++giftSeq).padStart(12, '0')}`, g.character, g.gift, g.price, g.stage, g.line],
    )
  }

  test('登入後可以送禮，user_id 自動帶入', async () => {
    assert.equal((await give(A)).ok, true)
    const r = await as(db, A, `select user_id, gift_id from public.gifts`)
    assert.deepEqual(r.rows, [{ user_id: A, gift_id: 'strawberry_cake' }])
  })

  test('同一個 id 重送不會重複', async () => {
    const id = 'fafafafa-1111-4000-8000-000000000001'
    const sql = `insert into public.gifts (id, character_id, gift_id, price, stage, given_at)
                 values ($1, 'yiqing', 'latte', 20, 0, now()) on conflict (id) do nothing`
    await as(db, A, sql, [id])
    await as(db, A, sql, [id])
    const r = await as(db, A, `select count(*)::int as n from public.gifts where id = $1`, [id])
    assert.equal(r.rows[0].n, 1)
  })

  test('看不到別人送的禮物，也不能替別人送', async () => {
    const r = await as(db, B, `select count(*)::int as n from public.gifts`)
    assert.equal(r.rows[0].n, 0)
    const t = await tryAs(
      db,
      B,
      `insert into public.gifts (id, user_id, character_id, gift_id, price, stage, given_at)
       values ('fafafafa-2222-4000-8000-000000000001', $1, 'fei', 'latte', 20, 0, now())`,
      [A],
    )
    assert.equal(t.ok, false)
  })

  test('欄位格式與範圍有檢查', async () => {
    assert.equal((await give(A, { character: 'Fei!' })).ok, false)
    assert.equal((await give(A, { gift: 'x'.repeat(41) })).ok, false)
    assert.equal((await give(A, { price: -1 })).ok, false)
    assert.equal((await give(A, { price: 1001 })).ok, false)
    assert.equal((await give(A, { stage: 6 })).ok, false)
    assert.equal((await give(A, { line: 'x'.repeat(61) })).ok, false)
  })

  test('送出去就不能修改或刪除', async () => {
    for (const sql of [`update public.gifts set price = 0`, `delete from public.gifts`]) {
      const t = await tryAs(db, A, sql)
      assert.ok(!t.ok || t.res.affectedRows === 0, sql)
    }
  })

  test('未登入不能讀寫', async () => {
    const r = await tryAs(db, null, `select * from public.gifts`)
    assert.ok(!r.ok || r.res.rows.length === 0)
    assert.equal((await give(null)).ok, false)
  })
})

describe('刪除帳號', () => {
  const C = '55555555-5555-4555-8555-555555555555'
  const count = async (table, col = 'user_id') =>
    (await db.query(`select count(*)::int as n from public.${table} where ${col} = $1`, [C])).rows[0].n

  before(async () => {
    await createUser(db, C, '真名丙')
    await answer(db, C, keys[0].question_id, keys[0].a)
    await as(
      db,
      C,
      `insert into public.mock_exams (id, paper_id, started_at, submitted_at, picks)
       values ('cccccccc-0000-4000-8000-000000000001', '115090_1', now() - interval '3 hours', now() - interval '1 hour', '{}')`,
    )
    await as(
      db,
      C,
      `insert into public.gifts (id, character_id, gift_id, price, stage, given_at)
       values ('cccccccc-1111-4000-8000-000000000001', 'fei', 'latte', 20, 0, now())`,
    )
    await as(
      db,
      C,
      `insert into public.reports (id, device_id, question_id, reason)
       values ('cccccccc-2222-4000-8000-000000000001', 'cccccccc-3333-4000-8000-000000000001', '115090_1_001', 'typo')`,
    )
  })

  test('沒登入不能呼叫', async () => {
    assert.equal((await tryAs(db, null, `select public.delete_my_account()`)).ok, false)
  })

  test('刪掉自己的帳號與所有資料；回報留著但連不回是誰；別人的資料不受影響', async () => {
    const othersBefore = (await db.query(`select count(*)::int as n from public.answers where user_id <> $1`, [C])).rows[0].n
    assert.equal(await count('answers'), 1)
    assert.equal((await tryAs(db, C, `select public.delete_my_account()`)).ok, true)
    assert.equal((await db.query(`select count(*)::int as n from auth.users where id = $1`, [C])).rows[0].n, 0)
    assert.equal(await count('profiles', 'id'), 0)
    for (const table of ['answers', 'mock_exams', 'gifts', 'reports']) assert.equal(await count(table), 0, table)
    const r = await db.query(`select user_id from public.reports where id = 'cccccccc-2222-4000-8000-000000000001'`)
    assert.deepEqual(r.rows, [{ user_id: null }])
    const othersAfter = (await db.query(`select count(*)::int as n from public.answers where user_id <> $1`, [C])).rows[0].n
    assert.equal(othersAfter, othersBefore)
  })
})

describe('帳號密碼註冊', () => {
  const signUp = (id, email, provider = 'email') =>
    db
      .query(`insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)`, [
        id,
        email,
        JSON.stringify({ provider, providers: [provider] }),
      ])
      .then(
        () => true,
        () => false,
      )

  test('Email 方式只接受「帳號名稱@users.invalid」', async () => {
    assert.equal(await signUp('66666666-6666-4666-8666-000000000001', 'roger_01@users.invalid'), true)
    assert.equal(await signUp('66666666-6666-4666-8666-000000000002', 'someone@gmail.com'), false)
    assert.equal(await signUp('66666666-6666-4666-8666-000000000003', 'ab@users.invalid'), false) // 太短
    assert.equal(await signUp('66666666-6666-4666-8666-000000000004', 'Roger@users.invalid'), false) // 前端會轉小寫
    assert.equal(await signUp('66666666-6666-4666-8666-000000000005', 'a.b_c@users.invalid'), false)
  })

  test('註冊後預設暱稱一樣是「同學」加四碼，不是帳號名稱', async () => {
    const r = await db.query(`select display_name from public.profiles where id = '66666666-6666-4666-8666-000000000001'`)
    assert.match(r.rows[0].display_name, /^同學[0-9A-F]{4}$/)
  })

  test('不能改成真實的 Email', async () => {
    const r = await db
      .query(`update auth.users set email = 'someone@gmail.com' where id = '66666666-6666-4666-8666-000000000001'`)
      .then(
        () => true,
        () => false,
      )
    assert.equal(r, false)
  })

  test('Google 登入不受影響', async () => {
    assert.equal(await signUp('66666666-6666-4666-8666-000000000006', 'someone@gmail.com', 'google'), true)
  })

  test('Google 帳號也不能把 Email 改成別人的 Email 或帳號名稱', async () => {
    const G = '66666666-6666-4666-8666-000000000006'
    await db.query(`insert into auth.identities (user_id, provider, identity_data) values ($1, 'google', '{"email": "someone@gmail.com"}')`, [G])
    for (const email of ['victim@gmail.com', 'taken_name@users.invalid']) {
      const ok = await db.query(`update auth.users set email = $2 where id = $1`, [G, email]).then(() => true, () => false)
      assert.equal(ok, false, email)
    }
  })

  test('Google 帳號的 Email 換了（Google 身分上的 Email 先更新），可以同步過來', async () => {
    const G = '66666666-6666-4666-8666-000000000006'
    await db.query(`update auth.identities set identity_data = '{"email": "new@gmail.com"}' where user_id = $1`, [G])
    await db.query(`update auth.users set email = 'new@gmail.com' where id = $1`, [G])
    // Email 沒變的更新（GoTrue 登入時會整筆更新）不受影響
    await db.query(`update auth.users set email = 'new@gmail.com' where id = $1`, [G])
  })
})
