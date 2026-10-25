-- 排行榜防偽造、暱稱不公開、擋改 Email（10/25 security review，reports/security-review.md 的 H1、H2、H3、M1、M2）
--
-- 設計：
-- - 正解本來就公開（題庫 JSON、SEO 靜態頁、repo 的 seed），擋不住照正解作答；這裡擋的是「一次請求就能做到」的偽造：
--   回填過去的作答時間、預先寫入未來的作答時間、補一筆「更早的第一次模擬考」、0 秒交卷、靠送分題刷正確率。
-- - 作答時間、模擬考的開始與交卷時間都是前端送的（離線作答之後才同步），資料庫只能用「收到的時間」判斷可不可信。
--   同步時間 synced_at 一律由資料庫決定；作答時間離收到的時間太遠（超過 3 天前或在未來）的紀錄照收，
--   錯題複習、好感度照常用，只是 ranked = false，不列入排行榜。3 天是離線作答之後才連上網路的寬限。
-- - 這個 migration 之前的紀錄一律 ranked = true：之前前端沒有送 synced_at，資料可信。

-- ---------- 作答 ----------

alter table public.answers add column ranked boolean not null default true;

create or replace function public.grade_answer()
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
  new.synced_at := now();
  new.ranked := new.answered_at between now() - interval '3 days' and now() + interval '5 minutes';
  return new;
end;
$$;

-- 週榜正確率：本週（週一 00:00 起）每題只算本週第一次作答（隔天重做也不算），送分題與四個選項都對的題目不算
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
         t.answered >= min_answers as qualified,
         t.user_id = auth.uid() as is_me
  from totals t
  join public.profiles p on p.id = t.user_id
  order by qualified desc, accuracy desc, t.answered desc
  limit 100;
$$;

-- 連續作答天數：只算 ranked 的作答，回填過去的日子不算
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

-- ---------- 模擬考 ----------
-- 「第一次」改用資料庫收到的順序（synced_at）決定，不再用前端送的 started_at，補一筆更早的模擬考不會取代第一次。
-- 第一次如果不列入排行榜（開始時間太舊、交卷時間在未來、作答不到 10 分鐘），這份考卷就沒有成績，不會改採第二次。

alter table public.mock_exams add column ranked boolean not null default true;

create function public.prepare_mock_exam()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := now();
  new.ranked := new.started_at >= now() - interval '3 days 2 hours 1 minute'
                and new.submitted_at <= now() + interval '5 minutes'
                and new.submitted_at - new.started_at >= interval '10 minutes';
  return new;
end;
$$;

create trigger prepare_mock_exam
  before insert on public.mock_exams
  for each row execute function public.prepare_mock_exam();

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
  order by b.score desc, b.seconds, p.display_name
  limit 100;
$$;

-- ---------- 暱稱只有自己看得到 ----------
-- 排行榜函式是 security definer，不受這條限制；前端只讀自己的暱稱。
-- 之前任何登入者都能列出所有人的 user id、暱稱、註冊時間（改版前登入的人暱稱可能還是 Google 真名）。

drop policy "登入者可以看到所有人的暱稱" on public.profiles;

create policy "只能看自己的暱稱"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- ---------- 不能改 Email ----------
-- 原本只擋 provider = 'email' 的帳號；Google 帳號可以呼叫 API 把 Email 改成別人的真實 Email
-- （線上關掉了 Confirm email，GoTrue 會直接套用），再設密碼就能用那個 Email 登入。
-- 網站沒有改 Email 的功能，所以一律擋下；唯一的例外是改成這個使用者 Google 身分上的 Email
-- （Google 帳號的 Email 換了，GoTrue 登入時同步過來）。

create or replace function public.check_username_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.raw_app_meta_data ->> 'provider' = 'email'
       and new.email is not null
       and new.email !~ '^[a-z0-9_]{3,20}@users\.invalid$' then
      raise exception '只能用帳號名稱註冊' using errcode = 'check_violation';
    end if;
  elsif new.email is distinct from old.email then
    if new.email is null or not exists (
      select 1 from auth.identities i
      where i.user_id = new.id
        and i.provider <> 'email'
        and lower(i.identity_data ->> 'email') = lower(new.email)
    ) then
      raise exception '不能修改 Email' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
