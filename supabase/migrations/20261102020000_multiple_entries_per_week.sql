-- Cho phép mỗi người viết nhiều bài trong ngày/tuần (bỏ giới hạn 1 bài/tuần).
-- Giờ mở khóa vẫn tính theo tuần: mọi bài trong tuần mở lúc 00:00 thứ Hai tuần sau.

drop index if exists public.journal_entries_one_per_author_week;

create index if not exists journal_entries_author_week
  on public.journal_entries (author_id, week_key, created_at);

-- Tác giả được xóa bài của mình trong tuần hiện tại.
create policy "Authors can delete entries in the current week"
  on public.journal_entries for delete to authenticated
  using (
    author_id = (select auth.uid())
    and public.has_role('member')
    and week_key = public.current_week_key()
  );

grant delete on public.journal_entries to authenticated;
