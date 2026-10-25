// 用 PGlite（編譯成 WebAssembly 的 Postgres）模擬 Supabase，實際執行 migration 與 seed。
// 模擬的部分：auth schema、auth.uid()、anon / authenticated 角色，以及 Supabase 預設給這兩個角色的權限。
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null, identity_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`

export const migrations = readdirSync(join(SUPABASE_DIR, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()

export async function createDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  return db
}

export async function applyMigration(db, file) {
  await db.exec(readFileSync(join(SUPABASE_DIR, 'migrations', file), 'utf8'))
}

export async function applySeed(db) {
  await db.exec(readFileSync(join(SUPABASE_DIR, 'seed', 'question_keys.sql'), 'utf8'))
}

/** 以某位使用者（或 null 代表未登入）的身分執行，模擬前端經由 Supabase API 的請求。 */
export async function as(db, userId, sql, params) {
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
  }
}

/** 同 as()，但把錯誤當成結果回傳，方便檢查「應該被擋下」的情況。 */
export async function tryAs(db, userId, sql, params) {
  try {
    return { ok: true, res: await as(db, userId, sql, params) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export async function createUser(db, id, name) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${id.slice(0, 8)}@example.com`,
    JSON.stringify({ name }),
  ])
}

let answerSeq = 0

/** 以使用者身分新增一筆作答；claimed 是前端宣稱的對錯，ago 是多久以前作答（Postgres interval）。 */
export async function answer(db, userId, questionId, picked, claimed = true, ago = '1 minute') {
  const id = `bbbbbbbb-0000-4000-8000-${String(++answerSeq).padStart(12, '0')}`
  const res = await as(
    db,
    userId,
    `insert into public.answers (id, question_id, picked, correct, answered_at)
     values ($1, $2, $3, $4, now() - $5::interval) returning correct, graded`,
    [id, questionId, picked, claimed, ago],
  )
  return res.rows[0]
}

/**
 * 把這位使用者目前的作答都當成「當時就同步上來」：synced_at 設成作答時間、列入排行榜。
 * 用來造過去幾天的正常紀錄；直接用 API 寫入太舊的作答時間，資料庫會標成不列入排行榜。
 */
export async function syncedOnTime(db, userId) {
  await db.query(`update public.answers set synced_at = answered_at, ranked = true where user_id = $1`, [userId])
}
