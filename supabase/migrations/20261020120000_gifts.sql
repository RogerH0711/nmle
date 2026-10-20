-- 禮物商店：送給學姊的禮物。
--
-- 設計：
-- - 貨幣「書籤」不存：前端由作答紀錄推算賺到多少，減掉這張表的 price 合計就是餘額（web/src/shop.ts）。
-- - 每送一次一筆，存送的時候的價格（之後調價不影響已經花掉的）和她當時的好感度階段（禮物的加成算在下一階）。
-- - 只增不改，和作答紀錄一樣由前端產生 id，重送不會重複。
-- - 餘額、一天一次、加成上限都由前端檢查，資料庫不檢查：禮物只影響自己的好感度，不進排行榜，
--   改前端送假資料也只騙得了自己。

create table public.gifts (
  id uuid primary key,                      -- 前端產生，重送時用來去重
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  character_id text not null check (character_id ~ '^[a-z_]{1,20}$'),   -- 例：fei
  gift_id text not null check (gift_id ~ '^[a-z_]{1,40}$'),             -- data/gifts.json 的 id
  price int not null check (price between 0 and 1000),
  stage smallint not null check (stage between 0 and 5),
  line_id text check (char_length(line_id) <= 60),                      -- 她當時說的台詞 id
  given_at timestamptz not null,
  synced_at timestamptz not null default now()
);

create index gifts_user on public.gifts (user_id, given_at);

alter table public.gifts enable row level security;

create policy "只能看自己送的禮物"
  on public.gifts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "只能新增自己送的禮物"
  on public.gifts for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 不開 update / delete：送出去就不能收回
