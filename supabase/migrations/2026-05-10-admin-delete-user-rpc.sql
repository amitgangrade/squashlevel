-- admin_delete_user RPC.
--
-- Lets a global admin fully remove another user via the Admin UI:
--   • Deletes the linked players row (FK is on delete set null, so without
--     this the player would survive as an orphan unclaimed row). Cascades
--     matches / group_members / challenges via on-delete-cascade FKs to
--     players(id).
--   • Deletes auth.users (cascades profiles via on delete cascade).
--
-- Self-delete is refused — admins can't accidentally lock themselves out.
-- Touching auth.users requires elevated privileges, hence security definer.
--
-- Safe to run multiple times (create or replace).

create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  delete from public.players where user_id = target_user_id;
  delete from auth.users    where id      = target_user_id;
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;
