-- 2026-05-17: rebuild_levels_finalize emits a summary audit event
--
-- Bug: running Admin → Rebuild Levels writes one audit_events row per
-- player (because the bulk UPDATE on `players` fires the per-row audit
-- trigger). At 1k players the audit log fills with "edited player X"
-- noise from every rebuild, burying real events and growing the table
-- linearly with rebuild frequency.
--
-- Fix: suppress per-row audit during the bulk UPDATE via the existing
-- `boast.audit_skip` session flag, then insert a single summary row
-- describing the rebuild ("Rebuilt levels for N players"). The summary
-- carries the actor + timestamp and is flagged privileged. Old per-row
-- audit rows from earlier rebuilds remain in the table — this only
-- affects future rebuilds.

create or replace function public.rebuild_levels_finalize()
returns int
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  affected   int;
  uid        uuid := auth.uid();
  actor_lbl  text;
begin
  if not public.is_admin(uid) then
    raise exception 'admin only';
  end if;
  perform set_config('boast.audit_skip', 'true', true);
  update public.players p
     set current_level  = ps.current_level,
         matches_played = ps.matches_played,
         levels_stale   = false
    from public.level_rebuild_state ps
   where p.id = ps.player_id;
  get diagnostics affected = row_count;
  truncate public.level_rebuild_state;
  perform set_config('boast.audit_skip', 'false', true);

  select coalesce(full_name, '') || ' <' || coalesce(email, '') || '>'
    into actor_lbl from public.profiles where id = uid;
  insert into public.audit_events (
    actor_user_id, actor_label, entity_type, op, summary, changed, privileged
  ) values (
    uid, actor_lbl, 'settings', 'update',
    format('Rebuilt levels for %s players', affected),
    jsonb_build_object('players_affected', affected, 'kind', 'rebuild_levels'),
    true
  );

  return affected;
end;
$$;
