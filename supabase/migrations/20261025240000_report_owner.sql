-- 回報疑義：登入的人也可以送出匿名回報（10/25 security review，reports/security-review.md 的 B4）
--
-- 回報先存在瀏覽器，連上網路才送出（web/src/reports.ts）。原本 user_id 由資料庫帶入送出當下登入的人，
-- 以 A 帳號回報、換成 B 帳號登入後才送出，回報就算到 B 頭上。前端改成回報時記下是誰，
-- 送出時登入的人不是他就改成匿名送出；所以登入的人也要能送 user_id 是 null 的回報。
-- user_id 還是不能填別人。

drop policy "任何人都可以回報，user_id 只能是自己" on public.reports;

create policy "任何人都可以回報，user_id 只能是自己或不填"
  on public.reports for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
