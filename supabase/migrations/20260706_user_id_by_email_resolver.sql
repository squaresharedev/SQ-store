-- Resolve an email to an existing auth user's id. Used server-side to address
-- an in-app notification to an invitee who already has an account (team
-- invites) before they've linked their membership.
--
-- SECURITY DEFINER so it can read auth.users, but EXECUTE is granted to
-- service_role ONLY (revoked from anon/authenticated) — it is never exposed on
-- the client RPC surface, so it can't be used as an email-enumeration oracle.
-- The only caller is the service-role admin client (lib/notifications/create).
create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1
$$;

revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
