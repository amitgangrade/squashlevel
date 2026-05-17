-- 2026-05-17: email-based claim suggestion in onboarding
--
-- The onboarding modal previously suggested unclaimed players to claim by
-- matching the typed full name (ILIKE on every token). Name is a poor key
-- — many users share a first/last name — so suggestions were noisy and
-- the user could miss a real email-match if their typed name didn't quite
-- align with the stub.
--
-- This RPC mirrors the server's email auto-claim logic (`norm_email` so
-- gmail dot/plus normalisation is consistent). The client calls it once
-- on modal mount with the signed-in user's email; if it returns a row,
-- the UI surfaces it as the claim suggestion.

create or replace function public.find_unclaimed_by_email(p_email text)
returns setof public.players
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.players
  where user_id is null
    and email is not null
    and public.norm_email(email) = public.norm_email(p_email)
  order by created_at asc
  limit 5;
$$;

grant execute on function public.find_unclaimed_by_email(text) to authenticated;
