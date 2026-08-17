-- =============================================================================
-- 0018  Outbound email
-- =============================================================================
--
-- Contractors could sign in one way only: a link texted to the number on file.
-- That made accepting text messages a condition of using the system, which is
-- the opposite of what the published consent notice says, and left a contractor
-- who opted out able to accept work from a link but never to get back in.
--
-- Deliberately a table of its own rather than a column on sms_messages. The two
-- carry different addresses, different failure modes and different status
-- vocabularies -- an email is not "delivered" in the sense a handset is -- and
-- widening the SMS table would have made every existing query check which kind
-- of message it had found.
-- ---------------------------------------------------------------------------

create type public.email_status as enum (
  'queued',    -- written before the provider was called
  'logged',    -- development driver: recorded, never sent
  'sent',      -- accepted by the provider
  'failed'     -- the provider rejected it
);

create table public.email_messages (
  id          uuid primary key default extensions.gen_random_uuid(),

  -- Shape only. Deliverability is the provider's answer, not a constraint's,
  -- and a CHECK strict enough to be useful here would reject valid addresses.
  to_email    text not null check (position('@' in to_email) > 1),
  subject     text not null,
  body        text not null,

  provider    text not null default 'dev' check (provider in ('dev', 'resend')),
  provider_id text,
  status      public.email_status not null default 'queued',
  error       text,
  purpose     text,

  profile_id  uuid references public.profiles (id) on delete set null,
  job_id      uuid references public.jobs (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index email_messages_created_idx on public.email_messages (created_at desc);
create index email_messages_profile_idx on public.email_messages (profile_id, created_at desc);
create unique index email_messages_provider_id_idx on public.email_messages (provider_id)
  where provider_id is not null;

create trigger email_messages_set_updated_at
  before update on public.email_messages
  for each row execute function public.set_updated_at();

-- Operational data, admins only -- the same rule sms_messages follows. Note
-- what this protects: a sign-in email body contains a live single-use link, so
-- a contractor able to read this table could read other contractors' links.
alter table public.email_messages enable row level security;

create policy email_messages_admin_read on public.email_messages
  for select to authenticated
  using (public.is_admin());
