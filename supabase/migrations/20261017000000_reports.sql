-- 回報疑義：使用者回報題目、答案、圖片、學科分類有問題的題目，由 Roger 在 Supabase Dashboard 處理。
--
-- 設計：
-- - 沒登入也能回報（大部分朋友不會登入）。登入的話 user_id 自動帶入。
-- - 沒有人能讀這張表（沒有 select policy）：補充說明可能寫了個人資訊，只有 Dashboard 看得到。
-- - 處理狀態、處理備註、建立時間一律由資料庫決定，前端送什麼都會被蓋掉。
-- - 防濫用：同一台裝置每分鐘最多 5 筆；匿名回報合計每小時最多 200 筆。device_id 是前端產生、存在瀏覽器的亂數，
--   擋不住刻意偽造，只是擋住手滑連按和簡單的灌水。

create table public.reports (
  id uuid primary key,                      -- 前端產生，重送時用來去重
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  device_id uuid not null,
  question_id text not null check (question_id ~ '^\d{6}_[12]_\d{3}$'),
  reason text not null check (reason in ('answer', 'typo', 'image', 'subject', 'other')),
  note text check (char_length(note) <= 500),
  picked text check (picked in ('A', 'B', 'C', 'D')),  -- 回報時選的答案（還沒作答就是 null）
  build text check (char_length(build) <= 40),         -- 網站版本（部署時的 commit），對照當時的題庫
  status text not null default 'open' check (status in ('open', 'fixed', 'rejected')),
  admin_note text,                          -- Roger 處理時寫的備註
  created_at timestamptz not null default now()
);

create index reports_status on public.reports (status, created_at);
create index reports_device on public.reports (device_id, created_at);

alter table public.reports enable row level security;

-- 只能新增，user_id 只能是自己（沒登入就必須是 null）；不開 select / update / delete
create policy "任何人都可以回報，user_id 只能是自己"
  on public.reports for insert to anon, authenticated
  with check (user_id is not distinct from (select auth.uid()));

create function public.prepare_report()
returns trigger
language plpgsql
security definer  -- 要跨使用者計算回報次數，而一般角色讀不到這張表
set search_path = ''
as $$
begin
  if (select count(*) from public.reports
      where device_id = new.device_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception '回報太頻繁，請稍後再試';
  end if;
  if new.user_id is null and (select count(*) from public.reports
      where user_id is null and created_at > now() - interval '1 hour') >= 200 then
    raise exception '目前匿名回報太多，請稍後再試或登入後回報';
  end if;
  new.status := 'open';
  new.admin_note := null;
  new.created_at := now();
  return new;
end;
$$;

create trigger prepare_report
  before insert on public.reports
  for each row execute function public.prepare_report();

revoke execute on function public.prepare_report() from public, anon, authenticated;
