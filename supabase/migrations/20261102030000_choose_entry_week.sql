-- Cho phép chọn ngày (và do đó tuần) của bài, kể cả tuần đã qua.
-- - Không chọn được ngày trong tương lai (theo GMT+7).
-- - week_key và unlock_at tính từ ngày được chọn; bài viết bù cho tuần đã khép lại
--   sẽ hiện ngay cho người kia vì unlock_at đã qua.
-- - Sửa/xóa (và thêm/xóa media) được trong tuần mà bài được VIẾT (theo created_at).

create or replace function public.week_key_of(ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(ts at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW');
$$;

create or replace function public.prepare_journal_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or new.author_id <> (select auth.uid()) then
      raise exception 'Entry author must be the signed-in user';
    end if;

    new.entry_date := coalesce(new.entry_date, today);
    if new.entry_date > today then
      raise exception 'Entry date cannot be in the future';
    end if;

    new.created_at := now();
    new.week_key := to_char(new.entry_date, 'IYYY-"W"IW');
    new.unlock_at := (date_trunc('week', new.entry_date::timestamp) + interval '1 week') at time zone 'Asia/Ho_Chi_Minh';
    return new;
  end if;

  if old.author_id <> (select auth.uid()) then
    raise exception 'Only the entry author can edit it';
  end if;

  if public.week_key_of(old.created_at) <> public.current_week_key() then
    raise exception 'Entries can only be edited during the week they were written';
  end if;

  if new.author_id <> old.author_id
    or new.entry_date <> old.entry_date
    or new.week_key <> old.week_key
    or new.created_at <> old.created_at
    or new.unlock_at <> old.unlock_at then
    raise exception 'Entry ownership, date and creation fields cannot be changed';
  end if;

  return new;
end;
$$;

drop policy if exists "Authors can edit entries in the current week" on public.journal_entries;
create policy "Authors can edit entries in the current week"
  on public.journal_entries for update to authenticated
  using (
    author_id = (select auth.uid())
    and public.has_role('member')
    and public.week_key_of(created_at) = public.current_week_key()
  )
  with check (
    author_id = (select auth.uid())
    and public.has_role('member')
    and public.week_key_of(created_at) = public.current_week_key()
  );

drop policy if exists "Authors can delete entries in the current week" on public.journal_entries;
create policy "Authors can delete entries in the current week"
  on public.journal_entries for delete to authenticated
  using (
    author_id = (select auth.uid())
    and public.has_role('member')
    and public.week_key_of(created_at) = public.current_week_key()
  );

drop policy if exists "Authors upload media in the current week" on storage.objects;
create policy "Authors upload media in the current week"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'journal-media'
    and exists (
      select 1 from public.journal_entries e
      where e.id::text = (storage.foldername(name))[1]
        and e.author_id = (select auth.uid())
        and public.week_key_of(e.created_at) = public.current_week_key()
    )
  );

drop policy if exists "Authors delete media in the current week" on storage.objects;
create policy "Authors delete media in the current week"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'journal-media'
    and exists (
      select 1 from public.journal_entries e
      where e.id::text = (storage.foldername(name))[1]
        and e.author_id = (select auth.uid())
        and public.week_key_of(e.created_at) = public.current_week_key()
    )
  );
