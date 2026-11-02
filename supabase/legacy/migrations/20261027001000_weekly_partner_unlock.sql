drop policy if exists "Authors can read only their own entries" on public.journal_entries;
drop policy if exists "Members can read only unlocked entries or their own" on public.journal_entries;
drop policy if exists "Members can read own and unlocked weekly entries" on public.journal_entries;
drop policy if exists "Members can create their own entries" on public.journal_entries;
drop policy if exists "Authors can create entries in the current week" on public.journal_entries;
drop policy if exists "Authors can edit their own entries" on public.journal_entries;
drop policy if exists "Authors can edit entries before unlock" on public.journal_entries;
drop policy if exists "Authors can edit entries in the current week" on public.journal_entries;

alter table public.journal_entries add column if not exists entry_date date;
update public.journal_entries
set entry_date = (created_at at time zone 'Asia/Ho_Chi_Minh')::date
where entry_date is null;
alter table public.journal_entries alter column entry_date set not null;
update public.journal_entries
set week_key = to_char(entry_date::timestamp, 'IYYY-"W"IW');

alter table public.journal_entries add column if not exists unlock_at timestamptz;
update public.journal_entries
set unlock_at = (
  date_trunc('week', entry_date::timestamp) + interval '1 week'
) at time zone 'Asia/Ho_Chi_Minh'
where unlock_at is null;
alter table public.journal_entries alter column unlock_at set not null;

drop index if exists public.journal_entries_one_per_author_day;
drop index if exists public.journal_entries_one_per_author_week;

do $$
begin
  if exists (
    select 1
    from public.journal_entries
    group by couple_id, author_id, week_key
    having count(*) > 1
  ) then
    raise exception 'Multiple daily entries exist for one author/week. Back up and consolidate them into one weekly entry per author before rerunning this migration.';
  end if;
end;
$$;

create unique index journal_entries_one_per_author_week
  on public.journal_entries (couple_id, author_id, week_key);

create or replace function public.prepare_journal_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_week text;
  local_entry_date timestamp;
begin
  current_week := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW');

  if tg_op = 'INSERT' then
    if auth.uid() is null or new.author_id <> (select auth.uid()) then
      raise exception 'Entry author must be the signed-in user';
    end if;

    new.created_at := now();
    local_entry_date := new.entry_date::timestamp;
    new.week_key := to_char(local_entry_date, 'IYYY-"W"IW');

    if new.week_key <> current_week then
      raise exception 'New journal entries are allowed only in the current week';
    end if;

    new.unlock_at := (date_trunc('week', local_entry_date) + interval '1 week')
      at time zone 'Asia/Ho_Chi_Minh';
    return new;
  end if;

  if old.author_id <> (select auth.uid()) then
    raise exception 'Only the entry author can edit it';
  end if;

  if old.week_key <> current_week then
    raise exception 'Entries from previous weeks are read-only';
  end if;

  if new.author_id <> old.author_id
    or new.couple_id <> old.couple_id
    or new.entry_date <> old.entry_date
    or new.week_key <> old.week_key
    or new.created_at <> old.created_at
    or new.unlock_at <> old.unlock_at then
    raise exception 'Entry ownership and time-lock fields cannot be changed';
  end if;

  return new;
end;
$$;

create policy "Members can read own and unlocked weekly entries"
  on public.journal_entries for select to authenticated
  using (
    public.is_journal_member(couple_id)
    and (author_id = (select auth.uid()) or unlock_at <= now())
  );

create policy "Members can create their own entries"
  on public.journal_entries for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_journal_member(couple_id)
    and week_key = to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW')
  );

create policy "Authors can edit entries in the current week"
  on public.journal_entries for update to authenticated
  using (
    author_id = (select auth.uid())
    and public.is_journal_member(couple_id)
    and week_key = to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW')
  )
  with check (
    author_id = (select auth.uid())
    and public.is_journal_member(couple_id)
    and week_key = to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW')
  );
