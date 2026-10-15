-- 模擬考：一份考卷限時作答、交卷才看答案。成績列入排行榜。
--
-- 設計：
-- - 每次模擬考一筆，picks 存交卷時每題選的答案（{"115090_1_001": "C", ...}），沒作答的題目不會出現。
-- - 分數不存，排行榜依當下的 question_keys 現算：更正答案、補匯入正解後，成績會自動跟著更新。
-- - 交卷時前端另外把每題作答寫進 answers（錯題複習、週榜用），兩邊互不依賴。
-- - 只增不改；每份考卷只採計第一次模擬考，重考同一份不會刷高排名。

create table public.mock_exams (
  id uuid primary key,                      -- 前端產生，重送時用來去重
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  paper_id text not null check (paper_id ~ '^\d{6}_[12]$'),  -- 例：115090_1
  started_at timestamptz not null,
  submitted_at timestamptz not null,
  picks jsonb not null,
  synced_at timestamptz not null default now(),
  -- 限時 2 小時；多給 1 分鐘，容許時間到自動交卷的延遲
  check (submitted_at >= started_at and submitted_at <= started_at + interval '2 hours 1 minute'),
  check (jsonb_typeof(picks) = 'object'),
  -- 每題都要是這份考卷的題目，答案是 A–D
  check (not jsonb_path_exists(
    picks,
    '$.keyvalue() ? (!(@.key starts with $p) || !(@.key like_regex "^[0-9]{6}_[12]_[0-9]{3}$"))',
    jsonb_build_object('p', paper_id || '_')
  )),
  check (not jsonb_path_exists(picks, '$.* ? (@ != "A" && @ != "B" && @ != "C" && @ != "D")'))
);

create index mock_exams_user on public.mock_exams (user_id, started_at);

alter table public.mock_exams enable row level security;

create policy "只能看自己的模擬考"
  on public.mock_exams for select to authenticated
  using (user_id = (select auth.uid()));

create policy "只能新增自己的模擬考"
  on public.mock_exams for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 不開 update / delete：交卷後不能改

-- ---------- 正解匯入的補充 ----------
-- 沒出題但官方一律給分的題目（例如選項全是圖、解析不出來）也會匯入 question_keys，
-- 模擬考滿分才會和官方一樣是 100 分。這類題目沒人作答，不影響其他統計。

-- ---------- 排行榜 ----------
-- paper 為 null：每人取「各考卷第一次模擬考」中最好的一次。指定考卷：每人在這份考卷的第一次。
-- 同分時用時短的排前面。只回傳暱稱與成績，不回傳 user id 或作答內容。
create function public.leaderboard_mock(paper text default null)
returns table (display_name text, paper_id text, score int, total int, seconds int, papers int, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with firsts as (
    select distinct on (m.user_id, m.paper_id) m.user_id, m.paper_id, m.picks, m.started_at, m.submitted_at
    from public.mock_exams m
    where m.submitted_at <= now() + interval '5 minutes'
      and (paper is null or m.paper_id = paper)
    order by m.user_id, m.paper_id, m.started_at, m.id
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
    where s.total > 0  -- 還沒匯入正解的考卷不排名
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
  order by b.score desc, b.seconds, p.display_name
  limit 100;
$$;

revoke execute on function public.leaderboard_mock(text) from public, anon;
grant execute on function public.leaderboard_mock(text) to authenticated;
