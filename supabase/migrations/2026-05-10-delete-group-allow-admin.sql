-- Allow site-wide admins (is_admin) to call delete_group, in addition to
-- per-group admins (is_group_admin). Without this, the Admin UI's per-group
-- delete picker fails for groups the global admin isn't a member of.
--
-- Safe to run multiple times.

create or replace function public.delete_group(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin(auth.uid()) or public.is_group_admin(auth.uid(), p_id)) then
    raise exception 'admin only';
  end if;
  delete from public.groups where id = p_id;
  return true;
end;
$$;
