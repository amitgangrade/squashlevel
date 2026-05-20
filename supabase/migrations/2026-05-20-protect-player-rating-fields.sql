-- Protect public.players.current_level and matches_played from direct
-- UPDATE by non-admins.
--
-- The "self update player" RLS policy lets a player's owner (or a
-- club admin) update the row, but it is row-level — there is no
-- column restriction. The schema comment at line ~75 declares these
-- two fields as server-truth ("maintained by the matches trigger"),
-- but nothing actually enforces that on the UPDATE path. A signed-in
-- non-admin can run:
--
--   await supabase.from('players')
--     .update({ current_level: 9999, matches_played: 1000 })
--     .eq('id', myPlayerId)
--
-- and inflate themselves to the top of the leaderboard.
--
-- This BEFORE UPDATE trigger rejects changes to current_level and
-- matches_played unless:
--   1. auth.uid() is NULL — maintainer SQL run as `postgres`
--      (migrations, manual seed). Always trusted.
--   2. The caller is a global admin — covers manual rating set and
--      "Rebuild levels" (which runs admin-gated, so auth.uid() is
--      the admin who initiated it).
--   3. The update is happening inside the matches rating-write path —
--      `matches_after_levels` sets `boast.rating_write = 'true'`
--      (transaction-local) before its UPDATEs on players. Mirrors
--      the `boast.audit_skip` pattern already used by the cascade
--      triggers.
--
-- starting_level and seeded_rating are deliberately NOT protected
-- here. They are owner-settable at onboarding (via profile fields
-- that the sync_player_from_profile trigger mirrors to players), so
-- locking them at the players layer would break legitimate signup /
-- claim flows. The same exploit applies upstream (profile.email,
-- profile.starting_level, profile.seeded_rating are equally
-- mutable) and the right fix is column protection on the profile
-- side — tracked separately.
--
-- Safe to rerun (create or replace + drop trigger if exists).

create or replace function public.protect_player_rating_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_rating boolean;
  rating_ctx text;
begin
  changed_rating :=
       old.current_level  is distinct from new.current_level
    or old.matches_played is distinct from new.matches_played;

  if not changed_rating then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;
  if public.is_admin(auth.uid()) then
    return new;
  end if;
  rating_ctx := current_setting('boast.rating_write', true);
  if rating_ctx = 'true' then
    return new;
  end if;

  raise exception 'players.current_level and matches_played are server-truth fields and can only be changed by match recording or admin tools';
end;
$$;

drop trigger if exists players_protect_rating_fields on public.players;
create trigger players_protect_rating_fields
  before update on public.players
  for each row execute function public.protect_player_rating_fields();

-- matches_after_levels: set the rating-write GUC at the top of the
-- function so its UPDATEs on players pass the new trigger. The flag
-- is transaction-local (set_config(..., true)) so it cannot leak to
-- a different request — PostgREST runs each HTTP request in its own
-- transaction.
create or replace function public.matches_after_levels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_rated boolean;
  is_rated  boolean;
begin
  -- Signal to protect_player_rating_fields that the upcoming
  -- players UPDATEs are part of the legitimate match rating path.
  perform set_config('boast.rating_write', 'true', true);

  if tg_op = 'INSERT' then
    is_rated := (new.status = 'confirmed') and not coalesce(new.unranked, false);
    if is_rated and new.level_a_after is not null then
      update public.players
         set current_level = new.level_a_after,
             matches_played = matches_played + 1
       where id = new.player_a_id;
    end if;
    if is_rated and new.level_b_after is not null then
      update public.players
         set current_level = new.level_b_after,
             matches_played = matches_played + 1
       where id = new.player_b_id;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    was_rated := (old.status = 'confirmed') and not coalesce(old.unranked, false);
    is_rated  := (new.status = 'confirmed') and not coalesce(new.unranked, false);

    if not was_rated and is_rated then
      if new.level_a_after is not null then
        update public.players
           set current_level = new.level_a_after,
               matches_played = matches_played + 1
         where id = new.player_a_id;
      end if;
      if new.level_b_after is not null then
        update public.players
           set current_level = new.level_b_after,
               matches_played = matches_played + 1
         where id = new.player_b_id;
      end if;
    elsif was_rated and not is_rated then
      if old.level_a_after is not null and old.level_a_before is not null then
        update public.players
           set current_level = old.level_a_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_a_id;
      end if;
      if old.level_b_after is not null and old.level_b_before is not null then
        update public.players
           set current_level = old.level_b_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_b_id;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    was_rated := (old.status = 'confirmed') and not coalesce(old.unranked, false);
    if was_rated then
      if old.level_a_after is not null and old.level_a_before is not null then
        update public.players
           set current_level = old.level_a_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_a_id;
      end if;
      if old.level_b_after is not null and old.level_b_before is not null then
        update public.players
           set current_level = old.level_b_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_b_id;
      end if;
    end if;
    return old;
  end if;

  return null;
end;
$$;
