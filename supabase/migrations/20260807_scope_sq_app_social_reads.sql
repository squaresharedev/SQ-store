-- =============================================================================
-- SCOPE THE SQ-APP SOCIAL READS TO WHAT IS ACTUALLY PUBLIC
--
-- THESE TABLES BELONG TO SQ-APP, which shares this database. They are changed
-- from the Store repo because the Store's publishable anon key reaches them
-- too, and a security review has to be able to act on what it finds. Coordinate
-- any further change with whoever owns SQ-app.
--
-- WHAT WAS WRONG. `artifact_likes` and `follows` shipped with
-- `for select to anon, authenticated using (true)` — genuinely intended, and
-- reasonable for a public social product where like and follower counts are
-- meant to be visible. But `profiles.is_public` DEFAULTS TO FALSE, and the
-- companion migration sq_app_profiles_private_by_default made that explicit.
-- So every account is private unless it opts in, while its follow graph and
-- its likes were world-readable.
--
-- That is not only a count leak. `public.public_profiles` maps id -> username
-- for public accounts, so a reader could join the two and turn "anonymous"
-- UUIDs into named edges — including edges belonging to accounts that never
-- opted into being public at all.
--
-- WHY NOW. artifact_likes, follows and profiles.is_public are all empty or
-- zero in production at the time of writing: 0 public profiles, 0 follows,
-- 0 likes. There is no data to migrate and no live traffic to break, which
-- makes this the cheapest this fix will ever be.
--
-- THE RULE. Visibility of a like or a follow now follows the visibility of the
-- thing it is about, plus your own rows. Counts on a PUBLIC profile or a
-- PUBLIC collection keep working exactly as before; nothing about a private
-- account is legible to a stranger.
-- =============================================================================

-- ---- artifact_likes -----------------------------------------------------------
-- "You can see the like if you can see the artifact."
--
-- The subquery is evaluated under the CALLER's rights, so artifacts' own RLS
-- (artifacts_select_own / artifacts_select_public) decides it. That is the
-- point: this policy cannot drift away from artifact visibility, because it
-- does not restate it. Writing the collection/profile logic out again here
-- would create a second copy to keep in sync, and the copies would diverge.
drop policy if exists "artifact_likes_public_read" on public.artifact_likes;

create policy "artifact_likes_visible_read"
  on public.artifact_likes
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.artifacts a
      where a.id = artifact_likes.artifact_id
    )
    -- Your own like on something you can no longer see stays yours to remove.
    or (select auth.uid()) = user_id
  );

-- ---- follows ------------------------------------------------------------------
-- A follow edge is public when EITHER endpoint is a public profile: the
-- follower list of a public creator, and the "following" list shown on a public
-- profile, are both things a public profile is understood to expose. An edge
-- between two private accounts is visible only to the two of them.
--
-- Asked via the public_profiles VIEW, which is exactly how the existing
-- artifacts_public_read policy asks the same question. The view is SECURITY
-- DEFINER for this reason: a policy has to be able to check "is this profile
-- public?" on an anonymous reader's behalf, and `profiles` itself must never
-- carry an anon select policy — it holds tax_vat_id, tax_business_name and
-- tax_country next to the public fields.
--
-- Note for anyone reading the older migrations: public.profile_is_public() was
-- the original helper here and NO LONGER EXISTS in production. Do not
-- reintroduce a dependency on it.
drop policy if exists "follows_public_read" on public.follows;

create policy "follows_visible_read"
  on public.follows
  for select
  to anon, authenticated
  using (
    exists (select 1 from public.public_profiles pp where pp.id = follows.follower_id)
    or exists (select 1 from public.public_profiles pp where pp.id = follows.followee_id)
    or (select auth.uid()) = follower_id
    or (select auth.uid()) = followee_id
  );

comment on table public.artifact_likes is
  'SQ-app: one row per user-likes-artifact. Readable when the artifact is (inherits artifacts RLS); inserted/deleted only by their own user.';

comment on table public.follows is
  'SQ-app: follower_id follows followee_id. Readable when either endpoint is a public profile, or by the two parties; inserted/deleted only by their own follower.';
