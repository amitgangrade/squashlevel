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

-- Any authenticated user (your friend group) can read and write.
drop policy if exists "auth all players" on public.players;
create policy "auth all players" on public.players
  for all to authenticated using (true) with check (true);

drop policy if exists "auth all matches" on public.matches;
create policy "auth all matches" on public.matches
  for all to authenticated using (true) with check (true);

drop policy if exists "auth all settings" on public.settings;
create policy "auth all settings" on public.settings
  for all to authenticated using (true) with check (true);

-- Enable realtime on these tables
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.settings;
