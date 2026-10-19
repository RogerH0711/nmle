-- 匿名使用統計：每台裝置每天一筆，知道實際有多少人在用（沒登入的人在 profiles 看不到）。
--
-- 設計：
-- - 只記隨機的裝置代碼（前端產生、存在瀏覽器，和回報疑義同一個）、今天作答幾題、有沒有開角色模式、有沒有登入、網站版本。
--   不記 user id、email 或作答內容：就算登入了，這張表也連不回是誰。
-- - 只能透過 ping_usage() 寫入；沒有任何 policy，沒有人讀得到，只有 Dashboard 看得到（查詢方式見 supabase/README.md）。
-- - 同一台裝置同一天只有一筆，作答題數只增不減（重送、亂序都沒關係）。日期以台灣時間、由資料庫決定。

create table public.usage_daily (
  device_id uuid not null,
  day date not null,
  answered int not null default 0 check (answered between 0 and 5000),
  character_mode boolean not null,
  signed_in boolean not null,
  build text check (char_length(build) <= 40),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (device_id, day)
);

alter table public.usage_daily enable row level security;
-- 不開任何 policy：前端不能直接讀寫，只能呼叫下面的函式

create function public.ping_usage(device uuid, answered int, character_mode boolean, signed_in boolean, build text)
returns void
language plpgsql
security definer  -- 一般角色碰不到這張表，由函式代為寫入
set search_path = ''
as $$
begin
  if device is null or answered is null or answered < 0 or answered > 5000 then
    raise exception '使用統計的資料不合法';
  end if;
  insert into public.usage_daily as u (device_id, day, answered, character_mode, signed_in, build)
  values (device, (now() at time zone 'Asia/Taipei')::date, answered, coalesce(character_mode, false),
          coalesce(signed_in, false), left(build, 40))
  on conflict (device_id, day) do update
    set answered = greatest(u.answered, excluded.answered),
        character_mode = excluded.character_mode,
        signed_in = u.signed_in or excluded.signed_in,
        build = excluded.build,
        last_seen = now();
end;
$$;

revoke execute on function public.ping_usage(uuid, int, boolean, boolean, text) from public;
grant execute on function public.ping_usage(uuid, int, boolean, boolean, text) to anon, authenticated;
