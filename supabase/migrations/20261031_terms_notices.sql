-- Terms of Service changes take effect on a clock nobody picks by hand.
--
-- lib/legal/terms-notices.ts emails every account about a new version and,
-- once the last email has gone, writes when that version takes effect. The
-- CHECK below is the wall: a version cannot take effect sooner than 30 days
-- after its notices finished, unless it records why it had to (law, or an
-- imminent danger; Terms section 19). Mirrored by TERMS_NOTICE_DAYS in
-- lib/legal/terms-versions.ts, and a test holds the two together.

create table if not exists public.terms_versions (
  version              text primary key
                       check (version ~ '^tos-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  -- Why this version skipped the 30 days. 'baseline' is the version in force
  -- when this table was created, which had no notice to record.
  short_notice_reason  text check (short_notice_reason in ('baseline', 'law', 'danger')),
  notice_started_at    timestamptz,
  -- The date the emails state. effective_at is never earlier than this.
  planned_effective_at timestamptz,
  notice_completed_at  timestamptz,
  effective_at         timestamptz,
  created_at           timestamptz not null default now(),
  constraint terms_versions_thirty_days check (
    effective_at is null
    or short_notice_reason is not null
    or (notice_completed_at is not null
        and effective_at >= notice_completed_at + interval '30 days')
  )
);

comment on table public.terms_versions is
  'When each Terms of Service version took or takes effect. Public: Home reads it to show the version in force.';

-- Once a date is on record it stays: nobody can bring a version forward by
-- editing the row, including after a notice has gone out.
create or replace function public.terms_versions_keep_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.effective_at is not null and new.effective_at is distinct from old.effective_at then
    raise exception 'terms_versions: effective_at is fixed once set';
  end if;
  if old.notice_completed_at is not null
     and new.notice_completed_at is distinct from old.notice_completed_at then
    raise exception 'terms_versions: notice_completed_at is fixed once set';
  end if;
  if old.short_notice_reason is distinct from new.short_notice_reason then
    raise exception 'terms_versions: short_notice_reason is fixed once set';
  end if;
  return new;
end;
$$;

revoke all on function public.terms_versions_keep_dates() from public, anon, authenticated;

drop trigger if exists terms_versions_keep_dates on public.terms_versions;
create trigger terms_versions_keep_dates
  before update on public.terms_versions
  for each row execute function public.terms_versions_keep_dates();

-- One row per account per version: who was told, so a run that stopped halfway
-- resumes, and nobody gets the same notice twice.
create table if not exists public.terms_notice_sends (
  version  text not null references public.terms_versions (version) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  sent_at  timestamptz,
  attempts integer not null default 0,
  primary key (version, user_id)
);

alter table public.terms_versions     enable row level security;
alter table public.terms_notice_sends enable row level security;

revoke all on public.terms_versions     from public, anon, authenticated;
revoke all on public.terms_notice_sends from public, anon, authenticated;

-- Dates and version names only, no personal data.
grant select on public.terms_versions to anon, authenticated;
drop policy if exists terms_versions_read on public.terms_versions;
create policy terms_versions_read on public.terms_versions
  for select to anon, authenticated using (true);

grant all on public.terms_versions     to service_role;
grant all on public.terms_notice_sends to service_role;

insert into public.terms_versions (version, short_notice_reason, effective_at)
values ('tos-2026-10-11', 'baseline', '2026-10-11T00:00:00Z')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
