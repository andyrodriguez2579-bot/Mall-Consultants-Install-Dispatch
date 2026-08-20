-- =============================================================================
-- 0022  Outbound email queue
-- =============================================================================
--
-- Two emails go out within two hours of an installation request arriving: an
-- acknowledgment on the original thread, and a separate site-readiness note to
-- the RSM, the sales contact and the customer. Later the same queue carries the
-- scheduling confirmation and the invoice email.
--
-- A queue rather than a send, for three reasons.
--
-- Sending is done by n8n through the real Outlook mailbox, because a reply has
-- to land in the thread it answers and come from the address everyone already
-- writes to. This application decides what to say; it does not hold the
-- mailbox.
--
-- Retries are safe. n8n retries, and so do webhooks; a row that is claimed and
-- marked sent cannot be sent twice, whereas a fire-and-forget call has no
-- memory at all.
--
-- And it is inspectable. What was said to a customer, when, and whether it
-- actually left, is a question that gets asked weeks later.
-- ---------------------------------------------------------------------------

create type public.outbound_email_kind as enum (
  'acknowledgment',        -- reply-all on the original request thread
  'site_readiness',        -- separate note: scope, photos, access questions
  'schedule_confirmation', -- date and arrival window, to the customer
  'completion'             -- work done, with the invoice and report
);

create type public.outbound_email_status as enum (
  'draft',     -- composed, awaiting release
  'queued',    -- released; n8n may pick it up
  'sending',   -- claimed by a sender
  'sent',
  'failed',
  'cancelled'  -- superseded or called off before it left
);

create table public.outbound_emails (
  id           uuid primary key default extensions.gen_random_uuid(),
  kind         public.outbound_email_kind not null,

  request_id   uuid references public.install_requests (id) on delete cascade,
  job_id       uuid references public.jobs (id) on delete cascade,

  -- Arrays rather than a join table: these are the addresses that were on one
  -- email at one moment, and rewriting history when a contact changes would
  -- destroy the record of who was actually told.
  to_emails    text[] not null check (cardinality(to_emails) > 0),
  cc_emails    text[] not null default '{}',

  subject      text not null check (length(btrim(subject)) > 0),
  body         text not null check (length(btrim(body)) > 0),

  -- Threading. An acknowledgment that starts a new thread is an acknowledgment
  -- six people will not connect to the request they sent.
  reply_to_message_id text,
  conversation_id     text,

  status       public.outbound_email_status not null default 'draft',
  -- "Within two hours" is a promise about the latest it may go, so the time it
  -- becomes eligible is explicit rather than implied by when a poller runs.
  scheduled_for timestamptz not null default now(),

  claimed_at   timestamptz,
  sent_at      timestamptz,
  provider_message_id text,
  error        text,
  attempts     integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Belongs to something, and to only one thing.
  constraint outbound_emails_has_subject
    check (num_nonnulls(request_id, job_id) = 1),
  constraint outbound_emails_sent_has_time
    check ((status = 'sent') = (sent_at is not null))
);

-- The idempotency this whole table exists for: one acknowledgment per request,
-- one scheduling confirmation per job, however many times anything retries.
create unique index outbound_emails_request_kind_idx
  on public.outbound_emails (request_id, kind)
  where request_id is not null and status <> 'cancelled';

create unique index outbound_emails_job_kind_idx
  on public.outbound_emails (job_id, kind)
  where job_id is not null and status <> 'cancelled';

-- The sender's query: what is due to go out, oldest first.
create index outbound_emails_due_idx
  on public.outbound_emails (scheduled_for)
  where status = 'queued';

create trigger outbound_emails_set_updated_at
  before update on public.outbound_emails
  for each row execute function public.set_updated_at();

-- Administrative. A contractor has no business reading what was said to the
-- customer, and these carry the customer's own address.
alter table public.outbound_emails enable row level security;

create policy outbound_emails_admin_all on public.outbound_emails
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Claiming
--
-- Two pollers, or one poller retried, must not both send the same email. The
-- claim is a conditional update: whoever moves it out of 'queued' owns it, and
-- everyone else gets nothing back.
-- ---------------------------------------------------------------------------
create or replace function public.claim_outbound_emails(p_limit integer default 10)
returns setof public.outbound_emails
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.outbound_emails
     set status = 'sending',
         claimed_at = now(),
         attempts = attempts + 1
   where id in (
     select id
       from public.outbound_emails
      where status = 'queued'
        and scheduled_for <= now()
      order by scheduled_for
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked
   )
  returning *;
$$;

comment on function public.claim_outbound_emails(integer) is
  'Atomically hand the next due emails to one sender. Never callable by a client.';
