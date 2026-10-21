-- AURA AI: per-user profiles and cloud chat history.
create table if not exists public.aura_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aura_chats (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists aura_chats_user_updated_idx on public.aura_chats (user_id, updated_at desc);

alter table public.aura_profiles enable row level security;
alter table public.aura_chats enable row level security;

drop policy if exists "Users read own AURA profile" on public.aura_profiles;
create policy "Users read own AURA profile" on public.aura_profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users create own AURA profile" on public.aura_profiles;
create policy "Users create own AURA profile" on public.aura_profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Users update own AURA profile" on public.aura_profiles;
create policy "Users update own AURA profile" on public.aura_profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Users read own AURA chats" on public.aura_chats;
create policy "Users read own AURA chats" on public.aura_chats for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert own AURA chats" on public.aura_chats;
create policy "Users insert own AURA chats" on public.aura_chats for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own AURA chats" on public.aura_chats;
create policy "Users update own AURA chats" on public.aura_chats for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own AURA chats" on public.aura_chats;
create policy "Users delete own AURA chats" on public.aura_chats for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update on public.aura_profiles to authenticated;
grant select, insert, update, delete on public.aura_chats to authenticated;

create or replace function public.handle_new_aura_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.aura_profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_aura_user() from public, anon, authenticated;
drop trigger if exists on_aura_user_created on auth.users;
create trigger on_aura_user_created
after insert on auth.users
for each row execute procedure public.handle_new_aura_user();
