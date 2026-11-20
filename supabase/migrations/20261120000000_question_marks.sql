-- 收藏、不確定、筆記（11/20，reports/improvement-review.md 第 25、26 項）
--
-- 設計：
-- - 每人每題一列：收藏（favorite）、不確定（unsure，答對但沒把握，放在圖書館的「不確定」清單）、筆記（note）。
--   和作答、模擬考、送禮不同，這些會改來改去（取消收藏、改筆記），所以是可以 update 的一列，不是只增不改的紀錄。
-- - 兩台裝置都改過同一題時，updated_at（前端改的時間）新的贏。前端可能離線改、之後才同步，
--   所以 update 時 updated_at 比資料庫裡舊的，就保留資料庫的版本（trigger 回傳 old）。
-- - updated_at 不能在未來（超過 5 分鐘就改成現在），否則一筆假的未來時間會讓之後的修改永遠蓋不過去。
-- - synced_at 由資料庫決定，和其他表一樣。
-- - 全部取消（不收藏、不是不確定、沒有筆記）的列不刪，留著：另一台裝置同步時才知道已經取消了。
-- - 不進排行榜，只影響自己，所以只擋格式和數量（每人每天 2,000 次寫入），不檢查內容。

create table public.question_marks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null check (question_id ~ '^\d{6}_[12]_\d{3}$'),  -- 例：115090_1_062
  favorite boolean not null default false,
  unsure boolean not null default false,
  note text check (char_length(note) <= 2000),
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.question_marks enable row level security;

create policy "只能看自己的收藏與筆記"
  on public.question_marks for select to authenticated
  using (user_id = (select auth.uid()));

create policy "只能新增自己的收藏與筆記"
  on public.question_marks for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "只能修改自己的收藏與筆記"
  on public.question_marks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 不開 delete：取消就是把欄位改成 false／null（見上方設計）

create function public.prepare_question_mark()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;
  new.note := nullif(btrim(new.note), '');
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return old;  -- 比資料庫裡的舊：別台裝置已經改過更新的版本
    end if;
    new.user_id := old.user_id;
    new.question_id := old.question_id;
  end if;
  new.synced_at := now();
  return new;
end;
$$;

create trigger prepare_question_mark
  before insert or update on public.question_marks
  for each row execute function public.prepare_question_mark();

-- 每人每天的寫入上限（20261025200000_rate_limits.sql 的 limit_daily_writes），新增和修改都算
create trigger limit_daily_writes
  after insert or update on public.question_marks
  for each row execute function public.limit_daily_writes('2000');
