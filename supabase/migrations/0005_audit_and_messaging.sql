-- =============================================================================
-- 0005  Audit log, outbound SMS, passwordless login tokens
-- =============================================================================

-- Append-only record of every material action. Enforced immutable below by
-- trigger, so the log is trustworthy even against a compromised admin session
-- or a mistaken migration.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_role  public.user_role,
  -- Denormalized display name so the entry stays readable after the actor's
  -- profile is deleted.
  actor_label text,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_entity_idx  on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only (attempted %)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.reject_audit_mutation();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Outbound SMS. Every message is persisted before the provider is called, so
-- development mode and production share one auditable history.
-- ---------------------------------------------------------------------------
create table public.sms_messages (
  id            uuid primary key default extensions.gen_random_uuid(),
  to_phone      text not null check (to_phone ~ '^\+[1-9]\d{6,14}$'),
  body          text not null,
  provider      text not null default 'dev' check (provider in ('dev', 'twilio')),
  provider_sid  text,
  status        public.sms_status not null default 'queued',
  error         text,
  purpose       text,
  job_id        uuid references public.jobs (id) on delete set null,
  contractor_id uuid references public.contractors (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index sms_messages_job_idx     on public.sms_messages (job_id, created_at desc);
create index sms_messages_created_idx on public.sms_messages (created_at desc);
create unique index sms_messages_sid_idx on public.sms_messages (provider_sid)
  where provider_sid is not null;

create trigger sms_messages_set_updated_at
  before update on public.sms_messages
  for each row execute function public.set_updated_at();

-- Link an offer to the message that carried it, for delivery-status tracking.
alter table public.job_offers
  add column sms_message_id uuid references public.sms_messages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Passwordless sign-in tokens. A contractor tapping an SMS link presents one
-- of these; the server verifies it and mints a real Supabase session, so all
-- subsequent data access is governed by row-level security rather than by the
-- token itself.
-- ---------------------------------------------------------------------------
create table public.login_tokens (
  id          uuid primary key default extensions.gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose     text not null default 'magic_link',
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_ip  inet,
  created_at  timestamptz not null default now()
);

create index login_tokens_profile_idx on public.login_tokens (profile_id, created_at desc);
create index login_tokens_sweep_idx   on public.login_tokens (expires_at) where used_at is null;
