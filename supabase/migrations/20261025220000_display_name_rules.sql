-- 暱稱內容檢查、排行榜隱藏、排行榜門檻不能調低（10/25 security review，reports/security-review.md 的 L1、L2）
--
-- 設計：
-- - 暱稱原本只檢查長度，直接呼叫 API 可以設成純空白、RTL 控制字元（讓文字反向顯示）、零寬字元。
--   這裡擋控制字元、看不見的字元、頭尾空白；前端（web/src/login.ts 的 displayNameError）用同一套規則先檢查。
--   不擋和別人同名：預設暱稱是「同學」加 4 碼（65,536 種），要唯一就得處理撞名，等真的有人冒充再說。
-- - profiles.hidden：灌分、不雅暱稱由 Roger 在 Dashboard 的 Table Editor 設成 true，排行榜就不顯示他，
--   但他自己看得到自己（不會發現被隱藏，不會換帳號再來）。前端改不到這個欄位：authenticated 只能更新 display_name。
-- - 排行榜函式的門檻參數由前端傳，原本可以傳 1 看到更多人的活躍狀況；改成不能低於網站用的預設值。
--   參數保留不刪，舊版前端（快取）照樣呼叫得到。

-- ---------- 暱稱內容 ----------

-- 先把不合規則的舊暱稱換回預設值，否則加不上 constraint
update public.profiles
set display_name = '同學' || upper(substr(md5(id::text), 1, 4))
where display_name ~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]'
   or display_name ~ '^[[:space:]　]|[[:space:]　]$';

alter table public.profiles add constraint profiles_display_name_visible check (
  -- 控制字元、零寬字元、方向控制字元、看起來是空白的填充字元
  display_name !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]'
  -- 頭尾不能是空白（含全形空白），所以也不會是純空白
  and display_name !~ '^[[:space:]　]|[[:space:]　]$'
);

-- ---------- 排行榜隱藏 ----------

alter table public.profiles add column hidden boolean not null default false;

-- 使用者只能改暱稱，不能改 hidden、id、created_at
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------- 排行榜：排除隱藏的人（自己除外），門檻不能調低 ----------

create or replace function public.leaderboard_weekly(min_answers int default 50)
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
    select distinct on (a.user_id, a.question_id) a.user_id, a.correct
    from public.answers a
    join public.question_keys k on k.question_id = a.question_id
    cross join bounds b
    where a.graded
      and a.ranked
      and not k.free_point
      and cardinality(k.answers) < 4
      and a.answered_at >= b.week_start
      and a.answered_at <= now() + interval '5 minutes'
    order by a.user_id, a.question_id, a.answered_at, a.id
  ),
  totals as (
    select user_id, count(*)::int as answered, (count(*) filter (where correct))::int as correct
    from firsts
    group by user_id
  )
  select p.display_name, t.answered, t.correct,
         round(100.0 * t.correct / t.answered, 1) as accuracy,
         t.answered >= greatest(coalesce(min_answers, 50), 50) as qualified,
         t.user_id = auth.uid() as is_me
  from totals t
  join public.profiles p on p.id = t.user_id
  where not p.hidden or p.id = auth.uid()
  order by qualified desc, accuracy desc, t.answered desc
  limit 100;
$$;

create or replace function public.leaderboard_streaks(min_daily int default 10)
returns table (display_name text, streak int, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select a.user_id, (a.answered_at at time zone 'Asia/Taipei')::date as d
    from public.answers a
    where a.graded and a.ranked and a.answered_at <= now() + interval '5 minutes'
    group by 1, 2
    having count(*) >= greatest(coalesce(min_daily, 10), 10)
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
    and (not p.hidden or p.id = auth.uid())
  order by r.len desc
  limit 100;
$$;

create or replace function public.leaderboard_mock(paper text default null)
returns table (display_name text, paper_id text, score int, total int, seconds int, papers int, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with firsts as (
    select distinct on (m.user_id, m.paper_id) m.user_id, m.paper_id, m.picks, m.started_at, m.submitted_at, m.ranked
    from public.mock_exams m
    where paper is null or m.paper_id = paper
    order by m.user_id, m.paper_id, m.synced_at, m.started_at, m.id
  ),
  scored as (
    select f.user_id, f.paper_id,
           extract(epoch from f.submitted_at - f.started_at)::int as seconds,
           s.score, s.total
    from firsts f
    cross join lateral (
      select (count(*) filter (where k.free_point or (f.picks ->> k.question_id) = any (k.answers)))::int as score,
             count(*)::int as total
      from public.question_keys k
      where starts_with(k.question_id, f.paper_id || '_')
    ) s
    where f.ranked
      and f.submitted_at <= now() + interval '5 minutes'
      and s.total > 0  -- 還沒匯入正解的考卷不排名
  ),
  best as (
    select distinct on (user_id) user_id, paper_id, score, total, seconds,
           (count(*) over (partition by user_id))::int as papers
    from scored
    order by user_id, score desc, seconds, paper_id
  )
  select p.display_name, b.paper_id, b.score, b.total, b.seconds, b.papers, b.user_id = auth.uid() as is_me
  from best b
  join public.profiles p on p.id = b.user_id
  where not p.hidden or p.id = auth.uid()
  order by b.score desc, b.seconds, p.display_name
  limit 100;
$$;
