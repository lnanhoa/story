create extension if not exists pgcrypto with schema extensions;

create table public.journal_couples (
  id uuid primary key default gen_random_uuid(),
  invite_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.journal_members (
  couple_id uuid not null references public.journal_couples(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.journal_couples(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  week_key text not null,
  created_at timestamptz not null default now(),
  unlock_at timestamptz not null,
  body text not null default '',
  mood text not null default '😊',
  media jsonb not null default '[]'::jsonb,
  constraint journal_entries_mood_check
    check (mood in ('😊', '🥰', '😌', '😔', '😵‍💫', '🤍')),
  constraint journal_entries_media_array_check
    check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 7)
);

create unique index journal_entries_one_per_author_week
  on public.journal_entries (couple_id, author_id, week_key);

create table public.journal_reactions (
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('🤍', '✨', '🥰')),
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

create table public.journal_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.journal_replies (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.journal_couples(id) on delete cascade,
  week_key text not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create or replace function public.is_journal_member(target_couple uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.journal_members member
    where member.couple_id = target_couple
      and member.user_id = (select auth.uid())
  );
$$;

create or replace function public.create_journal_couple()
returns table (couple_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_code text;
  new_couple_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required';
  end if;

  if exists (
    select 1 from public.journal_members
    where user_id = (select auth.uid())
  ) then
    raise exception 'This account already belongs to a journal couple';
  end if;

  new_code := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.journal_couples (invite_hash, created_by)
  values (encode(extensions.digest(new_code, 'sha256'), 'hex'), (select auth.uid()))
  returning id into new_couple_id;

  insert into public.journal_members (couple_id, user_id)
  values (new_couple_id, (select auth.uid()));

  return query select new_couple_id, new_code;
end;
$$;

create or replace function public.join_journal_couple(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_couple uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required';
  end if;

  if invite_code is null or length(invite_code) <> 48 then
    raise exception 'Invalid invitation code';
  end if;

  if exists (
    select 1 from public.journal_members
    where user_id = (select auth.uid())
  ) then
    raise exception 'This account already belongs to a journal couple';
  end if;

  select couple.id into target_couple
  from public.journal_couples couple
  where couple.invite_hash = encode(extensions.digest(invite_code, 'sha256'), 'hex')
  for update;

  if target_couple is null then
    raise exception 'Invalid invitation code';
  end if;

  if (
    select count(*) from public.journal_members
    where couple_id = target_couple
  ) >= 2 then
    raise exception 'This journal couple is already full';
  end if;

  insert into public.journal_members (couple_id, user_id)
  values (target_couple, (select auth.uid()));

  return target_couple;
end;
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
    new.week_key := to_char(new.entry_date::timestamp, 'IYYY-"W"IW');
    if new.week_key <> to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'IYYY-"W"IW') then
      raise exception 'New journal entries are allowed only in the current week';
    end if;
    new.unlock_at := (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 week') at time zone 'Asia/Ho_Chi_Minh';
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

alter table public.journal_couples enable row level security;
alter table public.journal_members enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_reactions enable row level security;
alter table public.journal_comments enable row level security;
alter table public.journal_replies enable row level security;

create policy "Couple members can read their couple"
  on public.journal_couples for select to authenticated
  using (public.is_journal_member(id));

create policy "Couple members can read membership"
  on public.journal_members for select to authenticated
  using (public.is_journal_member(couple_id));

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

revoke all on function public.is_journal_member(uuid) from public, anon;
revoke all on function public.create_journal_couple() from public, anon;
revoke all on function public.join_journal_couple(text) from public, anon;
grant execute on function public.is_journal_member(uuid) to authenticated;
grant execute on function public.create_journal_couple() to authenticated;
grant execute on function public.join_journal_couple(text) to authenticated;

grant select on public.journal_couples, public.journal_members to authenticated;
grant select, insert, update on public.journal_entries to authenticated;
revoke all on public.journal_reactions, public.journal_comments, public.journal_replies from anon, authenticated;
