-- Lock challenge content from rewrite via the "owner cancel challenge"
-- RLS policy.
--
-- The existing UPDATE policy is row-level only — it gates *who* can
-- attempt an UPDATE (sender, recipient, admin) but its WITH CHECK
-- clause is the literal `true`, so any allowed caller can change any
-- column on the row. The inline comment ("Sender can cancel;
-- recipient (or RPC) handles accept/decline") states the intent —
-- only the status / responded_at fields should be writable here,
-- and the canonical path is `respond_to_challenge`. The
-- challenges spec (line 110) describes this policy as a "safety
-- net" for the trio, not a free-form editor.
--
-- Exploit before this fix:
--
--   -- Sender of challenge C rewrites the participants:
--   await supabase.from('challenges')
--     .update({ to_player_id: victim, from_player_id: attacker })
--     .eq('id', C)
--   -- USING check passes (created_by = attacker_uid)
--   -- WITH CHECK (true) passes → challenge participants rewritten
--
-- Same class also let sender change `message`, `proposed_date`,
-- `venue`, or status without going through the state machine.
--
-- Fix has two parts:
--   1. A BEFORE UPDATE trigger that, for non-admins:
--      - Holds `from_player_id`, `to_player_id`, `created_by`,
--        `created_at`, `message`, `proposed_date`, `venue` immutable.
--      - Enforces the documented state machine on `status`: only
--        `pending` may transition; terminal statuses cannot transition
--        back or sideways; transitions out of pending must land on a
--        legal terminal (accepted | declined | cancelled | expired).
--      Admins bypass (corrective ability preserved). Superuser SQL
--      (auth.uid() IS NULL) bypasses for migrations.
--   2. Tighten the policy's WITH CHECK to mirror USING (defense in
--      depth — the row must still belong to the trio after update).
--
-- The canonical write path (`respond_to_challenge` SECURITY DEFINER
-- RPC) only ever sets status + responded_at, both of which the
-- trigger permits, so normal app behaviour is unaffected. The client
-- (src/lib/supabase/challenges.ts) goes through RPCs for all writes
-- and never issues a direct UPDATE.

create or replace function public.protect_challenge_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Superuser SQL (no JWT) — trusted.
  if auth.uid() is null then
    return new;
  end if;

  -- Admin bypass — admins keep their corrective ability via direct
  -- UPDATE (e.g. fixing data after an import error). The canonical
  -- path for admins is still the RPC; this just avoids painting
  -- ourselves into a corner.
  if public.is_admin(auth.uid()) then
    return new;
  end if;

  -- Immutable identity / content. The challenge was issued via
  -- create_challenge; these fields define what challenge this IS and
  -- must not drift afterwards. To "change" any of them the user must
  -- cancel and re-issue.
  if old.from_player_id is distinct from new.from_player_id then
    raise exception 'challenges.from_player_id is immutable';
  end if;
  if old.to_player_id is distinct from new.to_player_id then
    raise exception 'challenges.to_player_id is immutable';
  end if;
  if old.created_by is distinct from new.created_by then
    raise exception 'challenges.created_by is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'challenges.created_at is immutable';
  end if;
  if old.message is distinct from new.message then
    raise exception 'challenges.message cannot be edited after the challenge is issued';
  end if;
  if old.proposed_date is distinct from new.proposed_date then
    raise exception 'challenges.proposed_date cannot be edited after the challenge is issued';
  end if;
  if old.venue is distinct from new.venue then
    raise exception 'challenges.venue cannot be edited after the challenge is issued';
  end if;

  -- State machine. Per challenges spec:
  --   pending --> accepted | declined | cancelled | expired (terminal)
  --   terminal --> (no transitions)
  if old.status is distinct from new.status then
    if old.status <> 'pending' then
      raise exception 'cannot transition challenge out of terminal status %', old.status;
    end if;
    if new.status not in ('accepted', 'declined', 'cancelled', 'expired') then
      raise exception 'invalid challenge transition: pending -> %', new.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists challenges_protect_columns on public.challenges;
create trigger challenges_protect_columns
  before update on public.challenges
  for each row execute function public.protect_challenge_columns();

-- Tighten WITH CHECK to mirror USING. With the trigger holding
-- created_by and to_player_id immutable for non-admins, this is
-- effectively the same set; making it explicit gives a second layer
-- of defense (and removes the misleading `with check (true)` that
-- read as "anyone in the USING set can write anything").
drop policy if exists "owner cancel challenge" on public.challenges;
create policy "owner cancel challenge" on public.challenges
  for update to authenticated
  using (
    public.is_admin(auth.uid())
    or created_by = auth.uid()
    or auth.uid() in (
      select user_id from public.players where id = to_player_id
    )
  )
  with check (
    public.is_admin(auth.uid())
    or created_by = auth.uid()
    or auth.uid() in (
      select user_id from public.players where id = to_player_id
    )
  );
