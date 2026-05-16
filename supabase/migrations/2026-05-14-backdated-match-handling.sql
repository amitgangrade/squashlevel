-- Backdated match handling (2026-05-14).
--
-- See openspec/specs/match-recording/spec.md and
-- openspec/specs/rating/spec.md for the spec; see
-- openspec/changes/backdated-match-handling/ for the proposal/design.
--
-- Three pieces:
--   1. matches_validate_date(): BEFORE INSERT/UPDATE trigger that rejects
--      matches dated outside [max(players.created_at::date), current_date].
--      A grandfather guard skips the check when an UPDATE doesn't change
--      `date` — so legacy rows that violate the new rule can still be
--      edited in non-date ways (e.g. fixing a score typo).
--
--   2. players.levels_stale boolean: signal that a backdated/non-latest
--      mutation has occurred since the last full rebuild. Surfaced in the
--      admin Rebuild Levels banner so admins can re-run the full rebuild
--      when convenient. We do NOT attempt a synchronous scoped recompute —
--      see design.md Decision 2 for why (transitive correctness).
--
--   3. matches_after_date_reorder(): AFTER INSERT/UPDATE/DELETE trigger
--      that sets `levels_stale = true` on both participants when the
--      mutated row's date is not strictly the latest among each
--      participant's confirmed match history.
--
--   4. rebuild_levels_finalize() patched to clear `levels_stale` for
--      every player on success — the full rebuild is the canonical
--      answer that resolves all staleness.
--
-- Idempotent — column add-if-not-exists, create-or-replace functions,
-- drop-if-exists/create triggers.

-- ---------- 1. Date validation trigger --------------------------------

create or replace function public.matches_validate_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a_created date;
  b_created date;
  floor_date date;
begin
  -- Grandfather guard: allow UPDATEs that don't change the date through
  -- without validation. This lets admins fix score typos on legacy rows
  -- that may pre-date the new rule, without forcing a data cleanup
  -- before this migration lands.
  if tg_op = 'UPDATE' and new.date = old.date then
    return new;
  end if;

  if new.date > current_date then
    raise exception 'match date is in the future (got %, today is %)',
      new.date, current_date;
  end if;

  select created_at::date into a_created from public.players where id = new.player_a_id;
  select created_at::date into b_created from public.players where id = new.player_b_id;

  if a_created is null or b_created is null then
    -- Player FKs are enforced elsewhere; if either lookup misses, let
    -- the FK violation surface the real error rather than masking it
    -- with a confusing date message.
    return new;
  end if;

  floor_date := greatest(a_created, b_created);
  if new.date < floor_date then
    raise exception 'match date precedes participant''s created_at (date=%, floor=%)',
      new.date, floor_date;
  end if;

  return new;
end;
$$;

drop trigger if exists matches_validate_date on public.matches;
create trigger matches_validate_date
  before insert or update on public.matches
  for each row execute function public.matches_validate_date();

-- ---------- 2. levels_stale column ------------------------------------

alter table public.players
  add column if not exists levels_stale boolean not null default false;

-- ---------- 3. AFTER trigger: flag non-latest mutations as stale ------

-- Returns true iff `the_date` is strictly greater than every other
-- confirmed-match date for `player_id` (other matches identified by
-- `exclude_match_id` being NULL or the row's id != exclude_match_id).
create or replace function public.is_latest_match_date(
  the_date date,
  player_id uuid,
  exclude_match_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from public.matches m
     where (m.player_a_id = player_id or m.player_b_id = player_id)
       and (m.status = 'confirmed' or m.status is null)
       and (exclude_match_id is null or m.id <> exclude_match_id)
       and m.date >= the_date
  );
$$;

create or replace function public.matches_after_date_reorder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  effective_date date;
  a_id uuid;
  b_id uuid;
  exclude_id uuid;
  is_rated_now boolean;
  was_rated boolean;
begin
  -- Identify the relevant participants and effective date for the
  -- staleness check. For INSERT/UPDATE, use new; for DELETE, use old.
  if tg_op = 'DELETE' then
    was_rated := (old.status = 'confirmed') and not coalesce(old.unranked, false);
    -- Only rated-match deletes can introduce staleness (an unrated row
    -- contributed nothing to history, so removing it doesn't reorder
    -- anything).
    if not was_rated then
      return old;
    end if;
    effective_date := old.date;
    a_id := old.player_a_id;
    b_id := old.player_b_id;
    exclude_id := old.id; -- exclude the row being deleted from the lookup
  else
    is_rated_now := (new.status = 'confirmed') and not coalesce(new.unranked, false);
    -- Pending and unranked rows don't affect rating history, so
    -- skip the staleness flagging for them.
    if not is_rated_now then
      return new;
    end if;
    effective_date := new.date;
    a_id := new.player_a_id;
    b_id := new.player_b_id;
    exclude_id := new.id; -- exclude self when checking "is anything else later?"
  end if;

  -- If the effective date is strictly the latest confirmed match for
  -- BOTH participants, the live incremental path produced canonical
  -- results — no staleness.
  if public.is_latest_match_date(effective_date, a_id, exclude_id)
     and public.is_latest_match_date(effective_date, b_id, exclude_id) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Otherwise, persisted level columns on this and/or downstream
  -- matches are no longer canonical. Flag both participants so the
  -- admin Rebuild banner picks them up.
  update public.players
     set levels_stale = true
   where id in (a_id, b_id);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists matches_after_date_reorder on public.matches;
create trigger matches_after_date_reorder
  after insert or update or delete on public.matches
  for each row execute function public.matches_after_date_reorder();

-- ---------- 4. Clear levels_stale on full rebuild finalize -----------

-- The full rebuild via rebuild_levels_chunk produces canonical level
-- columns for every confirmed match — so on finalize, every player's
-- staleness flag is by definition resolved.
create or replace function public.rebuild_levels_finalize()
returns int
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  affected int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.players p
     set current_level  = ps.current_level,
         matches_played = ps.matches_played,
         levels_stale   = false
    from public.level_rebuild_state ps
   where p.id = ps.player_id;
  get diagnostics affected = row_count;
  -- Defense in depth: clear staleness for any player not in the rebuild
  -- state table (shouldn't happen, but a stuck flag would be worse than
  -- a spurious clear).
  update public.players set levels_stale = false where levels_stale = true;
  truncate public.level_rebuild_state;
  return affected;
end;
$$;

grant execute on function public.rebuild_levels_finalize() to authenticated;
grant execute on function public.is_latest_match_date(date, uuid, uuid) to authenticated;
