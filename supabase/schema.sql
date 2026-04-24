-- SquashLevel Supabase schema
-- Run this once in your Supabase project SQL editor.

create table if not exists public.players (
  id uuid primary key,
  name text not null,
  starting_level numeric not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.matches (
  id uuid primary key,
  date date not null,
  player_a_id uuid not null references public.players(id) on delete cascade,
  player_b_id uuid not null references public.players(id) on delete cascade,
  games jsonb not null,
  type text not null check (type in ('friendly', 'box', 'league', 'tournament')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists matches_date_idx on public.matches (date);
create index if not exists matches_player_a_idx on public.matches (player_a_id);
create index if not exists matches_player_b_idx on public.matches (player_b_id);

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.settings enable row level security;

-- Public read-only access (no auth required). Only the owner email can write.
-- Change the email below if you fork this project.
drop policy if exists "auth all players" on public.players;
drop policy if exists "auth all matches" on public.matches;
drop policy if exists "auth all settings" on public.settings;

drop policy if exists "public read players" on public.players;
create policy "public read players" on public.players
  for select using (true);

drop policy if exists "owner write players" on public.players;
create policy "owner write players" on public.players
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'amit.gangrade@gmail.com')
  with check (auth.jwt() ->> 'email' = 'amit.gangrade@gmail.com');

drop policy if exists "public read matches" on public.matches;
create policy "public read matches" on public.matches
  for select using (true);

drop policy if exists "owner write matches" on public.matches;
create policy "owner write matches" on public.matches
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'amit.gangrade@gmail.com')
  with check (auth.jwt() ->> 'email' = 'amit.gangrade@gmail.com');

drop policy if exists "public read settings" on public.settings;
create policy "public read settings" on public.settings
  for select using (true);

drop policy if exists "owner write settings" on public.settings;
create policy "owner write settings" on public.settings
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'amit.gangrade@gmail.com')
  with check (auth.jwt() ->> 'email' = 'amit.gangrade@gmail.com');

-- Enable realtime on these tables (skip if already added)
do $$
begin
  begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when duplicate_object then null; end;
end $$;
