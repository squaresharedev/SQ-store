-- Team & Access shows real profile photos instead of initials, so the roster
-- needs each member's avatar_url alongside their display_name.
--
-- Safe to expose to fellow members: the RPC is already gated on the caller
-- holding 'team.read' for this account, and avatar_url is a URL in the PUBLIC
-- `avatars` storage bucket — it is not a secret, and the caller can already see
-- the member's name and email through this same function.
--
-- DROP + CREATE rather than CREATE OR REPLACE: Postgres cannot change a
-- function's OUT columns in place ("cannot change return type of existing
-- function"). Grants do not survive the drop, so they are re-applied below
-- exactly as the original migration set them.
drop function if exists public.team_roster(uuid, integer, integer);

create function public.team_roster(account uuid, page_limit integer default 50, page_offset integer default 0)
returns table (
  id uuid,
  member_user_id uuid,
  invited_email text,
  role public.team_role,
  status public.team_member_status,
  invited_at timestamptz,
  accepted_at timestamptz,
  display_name text,
  avatar_url text
)
language sql stable security definer
set search_path = ''
as $$
  select tm.id, tm.member_user_id, tm.invited_email, tm.role, tm.status,
         tm.invited_at, tm.accepted_at, p.display_name, p.avatar_url
  from public.team_members tm
  left join public.profiles p on p.id = tm.member_user_id
  where tm.account_owner_id = account
    and public.team_role_can(public.team_actor_role(account), 'team.read')
  order by public.team_role_rank(tm.role) desc, tm.invited_at asc, tm.id asc
  limit least(greatest(coalesce(page_limit, 50), 1), 100)
  offset greatest(coalesce(page_offset, 0), 0)
$$;

-- Re-apply the ORIGINAL grants exactly. `from public` matters as much as
-- `from anon`: CREATE FUNCTION hands PUBLIC an implicit EXECUTE, and every role
-- (including anon) inherits it, so revoking only anon would silently leave this
-- callable by signed-out clients — a privilege the dropped function did not
-- have. Verified against the sibling team_my_pending_invites ACL.
revoke execute on function public.team_roster(uuid, integer, integer) from public, anon;
grant execute on function public.team_roster(uuid, integer, integer)
  to authenticated, service_role;
