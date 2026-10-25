-- 寫入數量限制（10/25 security review，reports/security-review.md 的 M3、M4）
--
-- 設計：
-- - 之前作答、模擬考、送禮、回報、使用統計都沒有數量限制，一個帳號用迴圈就能塞滿免費方案的 500 MB。
--   這裡給每個使用者每天（台灣時間）一個上限，數字遠高於正常使用，只擋灌資料：
--     作答 10,000 筆（全部題庫約 2,400 題）、模擬考 100 次、送禮 300 次、登入後回報 100 筆。
--   超過就整批拒絕；前端的紀錄留在瀏覽器，隔天再同步。沒登入刷了很多題才登入的人，第一次同步可能要分幾天。
-- - 匿名回報：原本全站合計每小時 200 筆，一個人就能讓所有沒登入的人都回報不了。改成
--   同一題每小時 10 筆、全站每天 1,000 筆。全站上限還是擋不住刻意的人（要完全擋得加 CAPTCHA），
--   但被擋下的回報會留在瀏覽器、之後自動重送，不會遺失；登入後回報不受匿名上限影響。
-- - 使用統計：每天最多記 5,000 台新裝置，超過的不記也不報錯（只影響統計數字）。
-- - 計數存在 rate_limits，一個名稱、一個時間區段一筆。沒有任何 policy，只有下面 security definer 的函式能讀寫。

create table public.rate_limits (
  name text not null,                -- 例：answers:<user id>、reports_anon、reports_anon:<題目 id>
  window_start timestamptz not null, -- 這個區段的開始（每小時或台灣時間每天）
  used int not null default 0,
  primary key (name, window_start)
);

alter table public.rate_limits enable row level security;
-- 不開任何 policy

-- 用掉一次額度；回傳是否還在上限內。超過時呼叫的一方要自己決定報錯或略過。
-- 報錯會讓整個交易回滾，這次的計數也一起取消。
create function public.take_quota(quota_name text, per text, quota int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := case per
    when 'hour' then date_trunc('hour', now())
    else date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'
  end;
  n int;
begin
  insert into public.rate_limits as r (name, window_start, used) values (quota_name, w, 1)
  on conflict (name, window_start) do update set used = r.used + 1
  returning r.used into n;
  -- 偶爾清掉兩天前的計數，表不會一直長
  if random() < 0.001 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return n <= quota;
end;
$$;

revoke execute on function public.take_quota(text, text, int) from public, anon, authenticated;

-- ---------- 作答、模擬考、送禮：每人每天的上限 ----------
-- 用 after insert：前端用 upsert 重送（on conflict do nothing），已經存在、沒有真的寫入的紀錄不算額度。

create function public.limit_daily_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.take_quota(tg_table_name || ':' || new.user_id, 'day', tg_argv[0]::int) then
    raise exception '今天寫入的紀錄太多了，明天會自動繼續同步';
  end if;
  return null;
end;
$$;

create trigger limit_daily_writes
  after insert on public.answers
  for each row execute function public.limit_daily_writes('10000');

create trigger limit_daily_writes
  after insert on public.mock_exams
  for each row execute function public.limit_daily_writes('100');

create trigger limit_daily_writes
  after insert on public.gifts
  for each row execute function public.limit_daily_writes('300');

-- ---------- 回報疑義 ----------

create or replace function public.prepare_report()
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
  if new.user_id is not null then
    if not public.take_quota('reports:' || new.user_id, 'day', 100) then
      raise exception '今天回報太多了，請明天再試';
    end if;
  elsif not public.take_quota('reports_anon:' || new.question_id, 'hour', 10) then
    raise exception '這題目前匿名回報太多，請稍後再試或登入後回報';
  elsif not public.take_quota('reports_anon', 'day', 1000) then
    raise exception '目前匿名回報太多，請稍後再試或登入後回報';
  end if;
  new.status := 'open';
  new.admin_note := null;
  new.created_at := now();
  return new;
end;
$$;

-- ---------- 使用統計 ----------

create or replace function public.ping_usage(device uuid, answered int, character_mode boolean, signed_in boolean, build text)
returns void
language plpgsql
security definer  -- 一般角色碰不到這張表，由函式代為寫入
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if device is null or answered is null or answered < 0 or answered > 5000 then
    raise exception '使用統計的資料不合法';
  end if;
  -- 今天第一次出現的裝置才用額度；超過就不記，也不報錯。
  -- 分成兩層 if：SQL 的 and 不保證先算左邊，寫在一起的話已經記過的裝置也可能被扣額度
  if not exists (select 1 from public.usage_daily u where u.device_id = device and u.day = today) then
    if not public.take_quota('usage_new_devices', 'day', 5000) then
      return;
    end if;
  end if;
  insert into public.usage_daily as u (device_id, day, answered, character_mode, signed_in, build)
  values (device, today, answered, coalesce(character_mode, false), coalesce(signed_in, false), left(build, 40))
  on conflict (device_id, day) do update
    set answered = greatest(u.answered, excluded.answered),
        character_mode = excluded.character_mode,
        signed_in = u.signed_in or excluded.signed_in,
        build = excluded.build,
        last_seen = now();
end;
$$;
