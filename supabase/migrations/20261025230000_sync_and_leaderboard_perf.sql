-- 同步與排行榜的效能（10/25 security review，reports/security-review.md 的 B2、B3）
--
-- 設計：
-- - 前端改成只拉 synced_at 比上次新的作答（web/src/answers.ts），加 (user_id, synced_at) 的索引。
--   synced_at 從 20261025180000 起一律由資料庫決定；更早的紀錄前端本來就沒有送，也是資料庫的時間。
-- - 連續天數原本每次都掃所有人有史以來全部的作答。改成另外記每人每天作答幾題（answer_days），
--   作答寫入時由 trigger 加一；排行榜只讀這張表，筆數是「人數 × 有作答的天數」。
--   只算列入排行榜的作答（graded、ranked），和原本的規則一樣。先作答、之後才匯入正解的題目（例如剛加的新年度），
--   匯入正解時 seed 會重新判分，graded 改變時另一個 trigger 跟著調整。
-- - 模擬考算分原本用 starts_with 找這份考卷的正解，每一筆模擬考都掃整張 question_keys。
--   加一個由 question_id 算出來的 paper_id 欄位和索引。

-- ---------- 增量同步 ----------

create index answers_user_synced_at on public.answers (user_id, synced_at);

-- ---------- 每人每天作答幾題 ----------

create table public.answer_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,                 -- 台灣時間
  answered int not null default 0,
  primary key (user_id, day)
);

alter table public.answer_days enable row level security;
-- 不開任何 policy：只有排行榜函式（security definer）讀得到

insert into public.answer_days (user_id, day, answered)
select user_id, (answered_at at time zone 'Asia/Taipei')::date, count(*)
from public.answers
where graded and ranked
group by 1, 2;

-- after insert：前端用 upsert 重送（on conflict do nothing）時，已經存在、沒有真的寫入的紀錄不會重複計算
create function public.count_answer_day()
returns trigger
language plpgsql
security definer  -- 一般角色碰不到 answer_days
set search_path = ''
as $$
begin
  if new.graded and new.ranked then
    insert into public.answer_days as d (user_id, day, answered)
    values (new.user_id, (new.answered_at at time zone 'Asia/Taipei')::date, 1)
    on conflict (user_id, day) do update set answered = d.answered + 1;
  end if;
  return null;
end;
$$;

create trigger count_answer_day
  after insert on public.answers
  for each row execute function public.count_answer_day();

-- 匯入正解時重新判分（supabase/seed/question_keys.sql 最後的 update）：graded 改變的才調整
create function public.recount_answer_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.graded and new.ranked then
    insert into public.answer_days as d (user_id, day, answered)
    values (new.user_id, (new.answered_at at time zone 'Asia/Taipei')::date, 1)
    on conflict (user_id, day) do update set answered = d.answered + 1;
  elsif old.graded and old.ranked then
    update public.answer_days
    set answered = answered - 1
    where user_id = old.user_id and day = (old.answered_at at time zone 'Asia/Taipei')::date;
  end if;
  return null;
end;
$$;

create trigger recount_answer_day
  after update of graded on public.answers
  for each row when (old.graded is distinct from new.graded)
  execute function public.recount_answer_day();

create or replace function public.leaderboard_streaks(min_daily int default 10)
returns table (display_name text, streak int, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d.user_id, d.day as d
    from public.answer_days d
    where d.answered >= greatest(coalesce(min_daily, 10), 10)
      and d.day <= (now() at time zone 'Asia/Taipei')::date
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

-- ---------- 模擬考算分 ----------

alter table public.question_keys
  add column paper_id text generated always as (left(question_id, length(question_id) - 4)) stored;  -- 115090_1_062 → 115090_1

create index question_keys_paper on public.question_keys (paper_id);

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
      where k.paper_id = f.paper_id
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
