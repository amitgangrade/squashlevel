-- Server-side typeahead for the admin profile search.
--
-- Background: AdminManager previously called list_profiles_for_admin() which
-- returned every row. At a few thousand profiles the client downloads it all
-- and renders an uncapped list — fine at 100, broken at 10K. Replace with
-- a tokenised ilike search that returns up to p_limit rows, backed by GIN
-- trigram indexes on full_name + email.
--
-- Safe to run multiple times — `create or replace` + `create index if not
-- exists` make this idempotent.

create extension if not exists pg_trgm;

create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name gin_trgm_ops);
create index if not exists profiles_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);

create or replace function public.search_profiles_for_admin(
  p_query text default null,
  p_limit int default 25
)
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  capped_limit int := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if p_query is null or btrim(p_query) = '' then
    return query
      select * from public.profiles
      order by full_name
      limit capped_limit;
    return;
  end if;
  return query
    select p.*
    from public.profiles p
    where not exists (
      select 1
      from unnest(regexp_split_to_array(btrim(p_query), '\s+')) tok
      where (
        coalesce(p.full_name, '') || ' ' ||
        coalesce(p.email, '')     || ' ' ||
        coalesce(p.username, '')  || ' ' ||
        coalesce(p.club, '')
      ) !~* tok
    )
    order by p.full_name
    limit capped_limit;
end;
$$;

grant execute on function public.search_profiles_for_admin(text, int) to authenticated;
