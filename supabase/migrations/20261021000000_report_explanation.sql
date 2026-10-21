-- 回報疑義多一個原因「詳解有誤」：網站開始顯示 AI 生成的詳解（10/21）。

alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in ('answer', 'typo', 'image', 'subject', 'explanation', 'other'));
