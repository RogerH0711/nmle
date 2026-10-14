-- 醫師一階刷題：登入、作答紀錄
-- 在 Supabase Dashboard → SQL Editor 整份貼上執行一次。
--
-- 設計：
-- - 作答紀錄只增不改。錯題複習佇列（Leitner box）由前端從作答紀錄推算，不另外存，
--   多台裝置同步時不會互相覆蓋，之後調整複習間隔也不用搬資料。
-- - 每張表都開 Row Level Security，只能讀寫自己的資料；未登入（anon）完全碰不到。

-- ---------- 使用者暱稱（之後排行榜用） ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "登入者可以看到所有人的暱稱"
  on public.profiles for select to authenticated
  using (true);

create policy "只能修改自己的暱稱"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 第一次用 Google 登入時自動建立 profile，暱稱先用 Google 名稱
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1), '同學'), 30)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 作答紀錄 ----------

create table public.answers (
  id uuid primary key,                      -- 前端產生，重送時用來去重
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null check (question_id ~ '^\d{6}_[12]_\d{3}$'),  -- 例：115090_1_062
  picked text not null check (picked in ('A', 'B', 'C', 'D')),
  correct boolean not null,
  answered_at timestamptz not null,         -- 實際作答時間（離線作答之後才同步）
  synced_at timestamptz not null default now()
);

create index answers_user_answered_at on public.answers (user_id, answered_at);

alter table public.answers enable row level security;

create policy "只能看自己的作答紀錄"
  on public.answers for select to authenticated
  using (user_id = (select auth.uid()));

create policy "只能新增自己的作答紀錄"
  on public.answers for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 不開 update / delete：作答紀錄只增不改
