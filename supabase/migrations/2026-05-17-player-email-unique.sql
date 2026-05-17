-- 2026-05-17: enforce email uniqueness on players
--
-- Bug: admin used "Add player" (Roster page) to add two players with the
-- same email — both rows were created. The `create_unclaimed_player`
-- RPC already dedupes by email (returns existing row instead of
-- inserting a duplicate), but the direct upsert path used by
-- `store.addPlayer` / `backend.putPlayer` had no such check. The
-- structural fix is a unique index at the DB level so every write path
-- (RPC, direct upsert, future backfills) gets the same guarantee.
--
-- Case-insensitive (lower(email)) to match the existing dedup logic in
-- `create_unclaimed_player`. NULL emails are exempt via a partial index
-- — unclaimed legacy rows without email continue to exist; new stubs
-- now require email (per `create_unclaimed_player`'s `email required`
-- check), so the gap is closing organically.
--
-- Pre-flight check: if existing data violates the constraint, error out
-- with a query that surfaces the offending rows. The admin must
-- consolidate or delete duplicates before re-running this migration.

do $$
declare
  dup_count int;
begin
  select count(*) into dup_count from (
    select 1 from public.players
     where email is not null
     group by lower(email)
    having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception
      E'Cannot add unique email index: % distinct email(s) appear on multiple players.\n'
       'Resolve duplicates first. Inspect with:\n'
       '  select id, name, email, user_id, created_at\n'
       '  from public.players\n'
       '  where lower(email) in (\n'
       '    select lower(email) from public.players\n'
       '    where email is not null\n'
       '    group by lower(email) having count(*) > 1\n'
       '  )\n'
       '  order by lower(email), created_at;\n'
       'Then delete or repoint duplicates and re-run.',
      dup_count;
  end if;
end$$;

create unique index if not exists players_email_unique
  on public.players (lower(email))
  where email is not null;
