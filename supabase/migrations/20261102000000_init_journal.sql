-- Schema rút gọn: 1 project Supabase, 3 user (Hòa, June = member; Admin = admin).
-- Chạy một lần trên project MỚI (chưa chạy schema.sql cũ).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  week_key text not null default '',
  created_at timestamptz not null default now(),
  unlock_at timestamptz not null default now(),
  body text not null default '',
  mood text not null default '😊',
  media jsonb not null default '[]'::jsonb,
  constraint journal_entries_mood_check
    check (mood in ('😊', '🥰', '😌', '😔', '😵‍💫', '🤍')),
  constraint journal_entries_media_array_check
    check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 7)
);

create unique index journal_entries_one_per_author_week
  on public.journal_entries (author_id, week_key);

-- Tối đa 2 member.
create or replace function public.limit_members()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'member' and (
    select count(*) from public.profiles
    where role = 'member' and id <> new.id
  ) >= 2 then
    raise exception 'Only two journal members are allowed';
  end if;
  return new;
end;
$$;

create trigger profiles_limit_members
before insert or update on public.profiles
for each row execute function public.limit_members();

create or replace function public.has_role(target_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = target_role
  );
$$;

create or replace function public.current_week_key()
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW');
$$;

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
    new.entry_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
    new.week_key := public.current_week_key();
    new.unlock_at := (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 week') at time zone 'Asia/Ho_Chi_Minh';
    return new;
  end if;

  if old.author_id <> (select auth.uid()) then
    raise exception 'Only the entry author can edit it';
  end if;

  if old.week_key <> public.current_week_key() then
    raise exception 'Entries from previous weeks are read-only';
  end if;

  if new.author_id <> old.author_id
    or new.entry_date <> old.entry_date
    or new.week_key <> old.week_key
    or new.created_at <> old.created_at
    or new.unlock_at <> old.unlock_at then
    raise exception 'Entry ownership and creation fields cannot be changed';
  end if;

  return new;
end;
$$;

create trigger journal_entries_prepare
before insert or update on public.journal_entries
for each row execute function public.prepare_journal_entry();

-- Admin chỉ xem trạng thái, không xem nội dung bài.
create or replace function public.admin_entry_status()
returns table (
  author_name text,
  week_key text,
  created_at timestamptz,
  unlock_at timestamptz,
  is_unlocked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Admin only';
  end if;

  return query
    select p.display_name, e.week_key, e.created_at, e.unlock_at, e.unlock_at <= now()
    from public.journal_entries e
    join public.profiles p on p.id = e.author_id
    order by e.week_key desc, p.display_name;
end;
$$;

alter table public.profiles enable row level security;
alter table public.journal_entries enable row level security;

create policy "Signed-in users with a role can read profiles"
  on public.profiles for select to authenticated
  using (public.has_role('member') or public.has_role('admin'));

create policy "Members can read own and unlocked weekly entries"
  on public.journal_entries for select to authenticated
  using (
    public.has_role('member')
    and (author_id = (select auth.uid()) or unlock_at <= now())
  );

create policy "Members can create their own entries"
  on public.journal_entries for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.has_role('member')
  );

create policy "Authors can edit entries in the current week"
  on public.journal_entries for update to authenticated
  using (
    author_id = (select auth.uid())
    and public.has_role('member')
    and week_key = public.current_week_key()
  )
  with check (
    author_id = (select auth.uid())
    and public.has_role('member')
    and week_key = public.current_week_key()
  );

revoke all on public.profiles, public.journal_entries from anon;
revoke all on function public.has_role(text) from public, anon;
revoke all on function public.admin_entry_status() from public, anon;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.admin_entry_status() to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.journal_entries to authenticated;

-- Storage: bucket riêng tư, đường dẫn file = '<entry_id>/<tên file>'.
-- Đọc media khi đọc được bài (RLS của journal_entries áp dụng trong subquery).
insert into storage.buckets (id, name, public)
values ('journal-media', 'journal-media', false)
on conflict (id) do nothing;

create policy "Read media of readable entries"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-media'
    and exists (
      select 1 from public.journal_entries e
      where e.id::text = (storage.foldername(name))[1]
    )
  );

create policy "Authors upload media in the current week"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'journal-media'
    and exists (
      select 1 from public.journal_entries e
      where e.id::text = (storage.foldername(name))[1]
        and e.author_id = (select auth.uid())
        and e.week_key = public.current_week_key()
    )
  );

create policy "Authors delete media in the current week"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'journal-media'
    and exists (
      select 1 from public.journal_entries e
      where e.id::text = (storage.foldername(name))[1]
        and e.author_id = (select auth.uid())
        and e.week_key = public.current_week_key()
    )
  );
