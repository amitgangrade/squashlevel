-- Group admin match-write authority (2026-05-12).
--
-- Extend `can_write_match` so it returns TRUE when the caller is a group
-- admin AND both participating players are members of that group. The
-- predicate already powers:
--   - the matches INSERT / UPDATE / DELETE RLS policies (1585+)
--   - the confirm_match SECURITY DEFINER RPC override
-- so a single edit picks up everywhere: group admins gain the same
-- update/delete/confirm power club admins have today, but scoped to
-- matches entirely contained in a group they administer.
--
-- New helper `is_group_admin_for_pair(uid, p_a, p_b)` is the actual
-- predicate. Kept separate from `can_write_match` so it can be used
-- independently (e.g. in client-side scope fetches via RPCs).
--
-- New `list_my_group_admin_scope()` RPC returns the (group_id,
-- player_id[]) pairs the caller can admin matches in, so the client
-- can mirror the rule locally and decide whether to show Edit / Delete
-- buttons without first attempting the write.
--
-- See openspec/specs/match-recording/spec.md §Match RLS and
-- openspec/specs/groups/spec.md §Group admin capabilities.
--
-- Idempotent.

-- ---------- is_group_admin_for_pair --------------------------------------
create or replace function public.is_group_admin_for_pair(uid uuid, p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    -- Find a group I admin (via my owned player, with is_admin = true on
    -- my membership row) that contains BOTH p_a and p_b as members.
    select 1
    from public.group_members gm_admin
    join public.players myp on myp.id = gm_admin.player_id
    where myp.user_id = uid
      and gm_admin.is_admin = true
      and gm_admin.group_id in (
        select group_id from public.group_members where player_id = p_a
        intersect
        select group_id from public.group_members where player_id = p_b
      )
  );
$$;

grant execute on function public.is_group_admin_for_pair(uuid, uuid, uuid) to authenticated;

-- ---------- can_write_match (extended) -----------------------------------
create or replace function public.can_write_match(uid uuid, a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin(uid)
    or exists (
      -- Club admin of either participant's club.
      select 1
      from public.players p
      join public.club_admins ca on ca.club_slug = public.club_slug(p.club)
      where p.id in (a, b) and ca.user_id = uid
    )
    or public.is_group_admin_for_pair(uid, a, b);
$$;

-- ---------- list_my_group_admin_scope -----------------------------------
-- Returns one row per (group_id, player_id) pair for every group the
-- caller administers — the client uses this to build a Map<groupId,
-- Set<playerId>> and mirror `is_group_admin_for_pair` locally so the
-- Edit / Delete buttons on match cards know whether to render.
create or replace function public.list_my_group_admin_scope()
returns table(group_id uuid, player_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select gm_other.group_id, gm_other.player_id
  from public.group_members gm_admin
  join public.players myp on myp.id = gm_admin.player_id
  join public.group_members gm_other on gm_other.group_id = gm_admin.group_id
  where myp.user_id = auth.uid()
    and gm_admin.is_admin = true;
$$;

grant execute on function public.list_my_group_admin_scope() to authenticated;
