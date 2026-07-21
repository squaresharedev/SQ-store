-- =============================================================================
-- INTERACTION EVENTS (SQ-app): behavioral capture for the future feed
-- algorithm, per SQ-app algorithm.md §6 (canonical spec — column-for-column).
-- Append-only system of record for the recommender. CAPTURE ONLY: nothing
-- reads this yet; no ranking/scoring ships with it.
--
-- Privacy posture (§6 RLS + §8): the log is PRIVATE. RLS is enabled with NO
-- policies, and all table/sequence privileges are revoked from `anon` and
-- `authenticated`, so no client-facing role can select/insert/update/delete.
-- All writes go through SQ-app's /api/events ingestion route with the
-- service role (reports especially must never be client-readable).
-- Additive only: no existing table, policy, trigger, or function is modified.
-- =============================================================================

create table public.interaction_events (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete set null,      -- null = anonymous / no-consent
  session_id    text not null,                                          -- client-generated; anon attribution + sequencing
  event_type    text not null,                                          -- see vocabulary below
  artifact_id   uuid references public.artifacts(id)    on delete cascade,
  profile_id    uuid references public.profiles(id)     on delete cascade,   -- target creator (follows, profile views)
  collection_id uuid references public.collections(id)  on delete set null,
  surface       text not null,                                          -- 'discovery' | 'following' | 'search' | 'profile'
  position      int,                                                    -- rank slot where shown (position-bias modeling)
  dwell_ms      int,                                                    -- for dwell events
  metadata      jsonb not null default '{}',                            -- search query, referrer, etc.
  created_at    timestamptz not null default now()
);

comment on table public.interaction_events is
  'Behavioral event log for the future feed ranker (algorithm.md §6). Append-only, service-role writes only via SQ-app /api/events; never client-readable. Event vocabulary: impression, click, dwell, like, unlike, follow, unfollow, save, unsave, purchase, hide, report, search, profile_view.';

create index idx_events_artifact  on public.interaction_events (artifact_id, event_type, created_at desc);
create index idx_events_user       on public.interaction_events (user_id, created_at desc);
create index idx_events_session    on public.interaction_events (session_id, created_at);

-- ---- RLS: deny ALL direct client access (mandatory before ship) -------------
-- Enabled with zero policies: every anon/authenticated request is denied by
-- RLS itself. The privilege revokes below are belt-and-braces on top (Supabase
-- default privileges would otherwise grant table access to both roles).
-- service_role bypasses RLS and keeps its default grants — the ingestion
-- route is the only write path.
alter table public.interaction_events enable row level security;

revoke all on table public.interaction_events from anon, authenticated;
revoke all on sequence public.interaction_events_id_seq from anon, authenticated;
