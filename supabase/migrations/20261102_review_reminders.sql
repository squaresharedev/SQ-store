-- The one review reminder a buyer can ask for (lib/reviews/reminders.ts).
--
-- A review is asked for once the buyer HAS the goods, not straight after
-- paying. Before that, the buyer's order page offers a single reminder email,
-- and only a buyer who presses "Email me a reminder" gets one: a request for
-- a review is direct marketing in the EU (ePrivacy art. 13; BGH VI ZR 225/17),
-- so it needs the buyer's prior consent, which these columns record.
--
--   review_reminder_requested_at  when the buyer asked for it (the consent).
--                                 Asking again after stopping moves it on.
--   review_reminder_stopped_at    when they took it back (the order page, the
--                                 email's stop link, or their mail client's
--                                 one-click unsubscribe).
--   review_reminder_sent_at       when the daily job sent it.
--   review_reminder_dropped_at    when the job let it go unsent: the order was
--                                 reviewed already, or can no longer be, or
--                                 the reminder fell due too long ago.
--
-- Written by the service role only (the order page's route and the job), like
-- every other buyer-side column on orders.

alter table public.orders
  add column if not exists review_reminder_requested_at timestamptz,
  add column if not exists review_reminder_stopped_at   timestamptz,
  add column if not exists review_reminder_sent_at      timestamptz,
  add column if not exists review_reminder_dropped_at   timestamptz;

-- Nothing is sent, dropped or stopped that nobody asked for, and a reminder
-- is either sent or dropped, never both.
alter table public.orders drop constraint if exists orders_review_reminder_consent;
alter table public.orders add constraint orders_review_reminder_consent check (
  review_reminder_requested_at is not null
  or (review_reminder_sent_at is null and review_reminder_dropped_at is null and review_reminder_stopped_at is null)
);
alter table public.orders drop constraint if exists orders_review_reminder_settled_once;
alter table public.orders add constraint orders_review_reminder_settled_once check (
  review_reminder_sent_at is null or review_reminder_dropped_at is null
);

-- The job's queue: wanted, and not yet sent, dropped or stopped.
create index if not exists orders_review_reminder_due_idx
  on public.orders (review_reminder_requested_at)
  where review_reminder_requested_at is not null
    and review_reminder_sent_at is null
    and review_reminder_dropped_at is null
    and review_reminder_stopped_at is null;

notify pgrst, 'reload schema';
