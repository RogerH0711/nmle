-- 帳號密碼登入（不用 Email）：給不想用 Google 登入的人（10/25 朋友回饋擔心個資）。
--
-- 設計：
-- - Supabase Auth 一定要 Email，前端把帳號名稱轉成「名稱@users.invalid」註冊（web/src/login.ts）。
--   .invalid 是保留網域，信不會寄到任何人手上，所以線上要關掉「Confirm email」，忘記密碼也無法重設。
-- - 這裡擋下其他 Email 的 Email 方式註冊與改 Email：Email 方式一開，任何人都能直接呼叫 API，
--   用別人真實的 Email 註冊（沒有確認信）或寄登入連結。Google 登入的 provider 是 google，不受影響。
-- - 帳號名稱的規則和前端一致：3–20 個小寫英文字母、數字或底線。

create function public.check_username_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw_app_meta_data ->> 'provider' = 'email'
     and new.email is not null
     and new.email !~ '^[a-z0-9_]{3,20}@users\.invalid$' then
    raise exception '只能用帳號名稱註冊' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger check_username_email
  before insert or update of email on auth.users
  for each row execute function public.check_username_email();
