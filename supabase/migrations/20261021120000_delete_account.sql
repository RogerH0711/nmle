-- 刪除帳號：使用者自己在網站上刪除帳號與所有資料（10/21，隱私權政策承諾的做法）。
--
-- 設計：
-- - 刪掉 auth.users 的那一筆，其他表靠外鍵一起處理：profiles、answers、mock_exams、gifts 是 on delete cascade，
--   reports 是 on delete set null（回報的題目內容留著修題目用，但連不回是誰）。usage_daily 本來就沒有 user id。
-- - 只能刪自己（auth.uid()），沒登入不能呼叫。
-- - 不可復原；前端要先讓使用者確認。

create function public.delete_my_account()
returns void
language plpgsql
security definer  -- 一般角色碰不到 auth.users，由函式代為刪除
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '沒有登入';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
