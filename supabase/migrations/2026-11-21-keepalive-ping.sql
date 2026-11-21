-- Keep-alive endpoint for the free-tier Supabase project.
--
-- Free projects pause after ~7 days of low activity. The `keepalive.yml`
-- GitHub workflow (and optionally an external cron) calls this daily via
-- POST /rest/v1/rpc/ping with only the anon key. It reads a real table so
-- the call registers as database activity, not just an API-gateway hit.
create or replace function public.ping()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform 1 from public.players limit 1;
  return now();
end;
$$;

grant execute on function public.ping() to anon, authenticated;
