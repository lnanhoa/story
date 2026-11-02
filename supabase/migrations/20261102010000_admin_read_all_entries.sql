-- Admin được đọc toàn bộ bài (kể cả bài chưa tới giờ mở) và media đi kèm.
-- Chỉ đọc: policy insert/update vẫn yêu cầu role member.
-- Media tự áp dụng vì policy Storage kiểm tra qua select journal_entries.

create policy "Admin can read all entries"
  on public.journal_entries for select to authenticated
  using (public.has_role('admin'));
