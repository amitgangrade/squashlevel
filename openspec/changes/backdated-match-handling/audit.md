# Pre-flight audit: existing match-date violations

Run this query in production BEFORE landing the date-validation migration. The
trigger will reject any future UPDATE on a row that violates the rule (e.g. an
admin trying to edit games/notes on a legacy bad row) unless we either:

1. Fix the offending rows first (move `players.created_at` backward or delete
   the matches), or
2. Rely on the grandfather guard in the trigger (`tg_op = 'UPDATE' AND
   new.date = old.date`), which permits edits that don't change the date.

## Audit query

```sql
-- Pre-date-of-creation violators (per side)
select
  m.id,
  m.date as match_date,
  pa.id as player_a_id, pa.name as player_a_name, pa.created_at::date as a_created,
  pb.id as player_b_id, pb.name as player_b_name, pb.created_at::date as b_created,
  case
    when m.date < pa.created_at::date and m.date < pb.created_at::date then 'both'
    when m.date < pa.created_at::date then 'a_only'
    when m.date < pb.created_at::date then 'b_only'
  end as which
from public.matches m
join public.players pa on pa.id = m.player_a_id
join public.players pb on pb.id = m.player_b_id
where m.date < pa.created_at::date
   or m.date < pb.created_at::date
order by m.date;

-- Future-dated violators
select id, date, player_a_id, player_b_id
from public.matches
where date > current_date
order by date;

-- Counts at a glance
select
  sum(case when date < (select created_at::date from public.players where id = m.player_a_id) then 1 else 0 end) as pre_a_count,
  sum(case when date < (select created_at::date from public.players where id = m.player_b_id) then 1 else 0 end) as pre_b_count,
  sum(case when date > current_date then 1 else 0 end) as future_count
from public.matches m;
```

## Findings

_Fill in after running the audit:_

- `pre_a_count`: TBD
- `pre_b_count`: TBD
- `future_count`: TBD

## Disposition

_Decide and record:_

- [ ] All counts are zero → ship the migration as written; the grandfather guard
  is a defensive no-op and can stay.
- [ ] Non-zero pre-`created_at` rows → either (a) fix data (`update players set
  created_at = '<earlier>' where id = ...`) or (b) keep the grandfather guard
  so existing rows can still be edited in non-date ways. **The trigger as
  shipped always permits UPDATEs where `new.date = old.date`** — that already
  covers the common "fix a score typo on a legacy bad row" case.
- [ ] Future-dated rows → these are almost certainly typos. Fix the data
  (`update matches set date = ... where id = ...`) before landing the trigger.

Tracked tasks in `tasks.md`: 1.1, 1.2.
