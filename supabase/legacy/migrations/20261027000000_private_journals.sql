-- Historical intermediate migration; apply 20261027001000_weekly_partner_unlock.sql to restore weekly partner access.
drop policy if exists "Members can read only unlocked entries or their own" on public.journal_entries;
drop policy if exists "Authors can read only their own entries" on public.journal_entries;
drop policy if exists "Authors can edit entries before unlock" on public.journal_entries;
drop policy if exists "Authors can edit their own entries" on public.journal_entries;

drop policy if exists "Members can read reactions on readable entries" on public.journal_reactions;
drop policy if exists "Members can react to readable entries" on public.journal_reactions;
drop policy if exists "Members can update their own reactions" on public.journal_reactions;
drop policy if exists "Members can remove their own reactions" on public.journal_reactions;
drop policy if exists "Members can read comments on readable entries" on public.journal_comments;
drop policy if exists "Members can comment on readable entries" on public.journal_comments;
drop policy if exists "Members can read replies in their couple" on public.journal_replies;
drop policy if exists "Members can send replies after the week unlocks" on public.journal_replies;

alter table public.journal_entries add column if not exists entry_date date;
update public.journal_entries
set entry_date = (created_at at time zone 'Asia/Ho_Chi_Minh')::date
where entry_date is null;
alter table public.journal_entries alter column entry_date set not null;

drop index if exists public.journal_entries_one_per_author_week;
create unique index if not exists journal_entries_one_per_author_day
  on public.journal_entries (couple_id, author_id, entry_date);

alter table public.journal_entries drop column if exists unlock_at;

create or replace function public.prepare_journal_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or new.author_id <> (select auth.uid()) then
      raise exception 'Entry author must be the signed-in user';
    end if;

    new.created_at := now();
    new.week_key := to_char(new.entry_date::timestamp, 'IYYY-"W"IW');
    if new.week_key <> to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW') then
      raise exception 'New journal entries are allowed only in the current week';
    end if;
    return new;
  end if;

  if old.author_id <> (select auth.uid()) then
    raise exception 'Only the entry author can edit it';
  end if;

  if old.week_key <> to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW') then
    raise exception 'Entries from previous weeks are read-only';
  end if;

  if new.author_id <> old.author_id
    or new.couple_id <> old.couple_id
    or new.entry_date <> old.entry_date
    or new.week_key <> old.week_key
    or new.created_at <> old.created_at then
    raise exception 'Entry ownership and creation fields cannot be changed';
  end if;

  return new;
end;
$$;

create policy "Authors can read only their own entries"
  on public.journal_entries for select to authenticated
  using (
    author_id = (select auth.uid())
    and public.is_journal_member(couple_id)
  );

create policy "Authors can edit their own entries"
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

revoke all on public.journal_reactions, public.journal_comments, public.journal_replies from anon, authenticated;
drop function if exists public.can_read_journal_entry(uuid);
