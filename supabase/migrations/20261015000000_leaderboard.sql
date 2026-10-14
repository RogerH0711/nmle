-- 排行榜：資料庫判斷對錯、暱稱預設值、排行榜函式
-- 在 Supabase Dashboard → SQL Editor 整份貼上執行一次；執行完再執行 supabase/seed/question_keys.sql 匯入正解。

-- ---------- 正解（只有資料庫自己讀得到） ----------

create table public.question_keys (
  question_id text primary key,
  answers text[] not null,          -- 一題多解時有多個
  free_point boolean not null default false
);

-- 開 RLS 但不開任何 policy：前端讀不到也改不了，只有下面 security definer 的函式能讀
alter table public.question_keys enable row level security;

-- ---------- 作答時由資料庫判斷對錯 ----------

-- graded：資料庫有這題的正解、對錯是資料庫算的。排行榜只採計 graded 的紀錄。
alter table public.answers add column graded boolean not null default false;

create function public.grade_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  select answers, free_point into k from public.question_keys where question_id = new.question_id;
  if found then
    new.correct := k.free_point or new.picked = any (k.answers);
    new.graded := true;
  else
    -- 還沒匯入正解的題目（例如剛加的新年度）：先收下，不列入排行榜
    new.graded := false;
  end if;
  return new;
end;
$$;

create trigger grade_answer
  before insert on public.answers
  for each row execute function public.grade_answer();

create index answers_answered_at on public.answers (answered_at);

-- ---------- 暱稱預設不用真名 ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, '同學' || upper(substr(md5(new.id::text), 1, 4)));
  return new;
end;
$$;

-- ---------- 排行榜 ----------
-- 用 security definer 跨使用者彙總，但只回傳暱稱和統計數字，不回傳別人的 user id 或作答紀錄。
-- 時間一律以台灣時間計算；answered_at 是前端送的，晚於現在的紀錄不採計。

-- 週榜正確率：本週（週一 00:00 起）、同一題同一天只算第一次作答
create function public.leaderboard_weekly(min_answers int default 50)
returns table (display_name text, answered int, correct int, accuracy numeric, qualified boolean, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('week', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei') as week_start
  ),
  firsts as (
    select distinct on (a.user_id, a.question_id, (a.answered_at at time zone 'Asia/Taipei')::date)
      a.user_id, a.correct
    from public.answers a, bounds b
    where a.graded
      and a.answered_at >= b.week_start
      and a.answered_at <= now() + interval '5 minutes'
    order by a.user_id, a.question_id, (a.answered_at at time zone 'Asia/Taipei')::date, a.answered_at
  ),
  totals as (
    select user_id, count(*)::int as answered, (count(*) filter (where correct))::int as correct
    from firsts
    group by user_id
  )
  select p.display_name, t.answered, t.correct,
         round(100.0 * t.correct / t.answered, 1) as accuracy,
         t.answered >= min_answers as qualified,
         t.user_id = auth.uid() as is_me
  from totals t
  join public.profiles p on p.id = t.user_id
  order by qualified desc, accuracy desc, t.answered desc
  limit 100;
$$;

-- 連續作答天數：一天至少 min_daily 題才算；最後一天是今天或昨天才算還在連續中
create function public.leaderboard_streaks(min_daily int default 10)
returns table (display_name text, streak int, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select a.user_id, (a.answered_at at time zone 'Asia/Taipei')::date as d
    from public.answers a
    where a.graded and a.answered_at <= now() + interval '5 minutes'
    group by 1, 2
    having count(*) >= min_daily
  ),
  grouped as (
    select user_id, d, d - (row_number() over (partition by user_id order by d))::int as g
    from days
  ),
  runs as (
    select user_id, max(d) as last_day, count(*)::int as len
    from grouped
    group by user_id, g
  )
  select p.display_name, r.len as streak, r.user_id = auth.uid() as is_me
  from runs r
  join public.profiles p on p.id = r.user_id
  where r.last_day >= (now() at time zone 'Asia/Taipei')::date - 1
  order by r.len desc
  limit 100;
$$;

-- 只有登入的人能看排行榜（Supabase 預設會把函式執行權限給所有人，這裡收回）
revoke execute on function public.leaderboard_weekly(int) from public, anon;
revoke execute on function public.leaderboard_streaks(int) from public, anon;
grant execute on function public.leaderboard_weekly(int) to authenticated;
grant execute on function public.leaderboard_streaks(int) to authenticated;
