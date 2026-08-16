-- =============================================================================
-- 0001  Extensions and enumerated types
-- =============================================================================
-- Every domain state in this system is a Postgres enum rather than free text.
-- That makes illegal states unrepresentable at the storage layer instead of
-- relying on application code to be careful.

create extension if not exists "pgcrypto" with schema extensions;

-- Who can sign in, and with what powers.
create type public.user_role as enum ('admin', 'contractor');

-- Lifecycle of a contractor's relationship with Mall Consultants. Only
-- 'approved' contractors are ever eligible to receive or accept work.
create type public.contractor_status as enum ('pending', 'approved', 'suspended');

-- The twelve job statuses. Ordering here is deliberate: it follows the
-- happy-path lifecycle first, then the exceptional terminal states.
create type public.job_status as enum (
  'draft',        -- being written by an admin, not yet dispatchable
  'ready',        -- fully specified, awaiting dispatch
  'offered',      -- SMS offers are live; first eligible acceptance wins
  'assigned',     -- exactly one contractor holds the job
  'in_progress',  -- contractor confirmed arrival and started
  'completed',    -- contractor submitted photos + notes, awaiting review
  'needs_rework', -- admin rejected the submission with instructions
  'approved',     -- admin accepted the work; payment is now owed
  'paid',         -- payment recorded against the fixed contractor pay
  'on_hold',      -- temporarily paused by an admin
  'cancelled',    -- called off; terminal
  'unfilled'      -- every offer expired or passed; terminal until re-offered
);

-- Per-contractor delivery + response state for a single dispatch round.
create type public.offer_status as enum (
  'pending',    -- row created, SMS not yet handed to the provider
  'sent',       -- provider accepted the message
  'delivered',  -- provider confirmed handset delivery
  'viewed',     -- contractor opened the secure link
  'accepted',   -- contractor won the job
  'passed',     -- contractor explicitly declined
  'expired',    -- offer window closed without a response
  'filled',     -- another contractor won it first
  'failed'      -- provider rejected or could not deliver the message
);

-- What a stored file represents. Before/after photos are the evidence an
-- admin reviews when approving work.
create type public.attachment_kind as enum ('brief', 'before', 'after', 'other');

-- Provider-reported state of an outbound SMS. 'logged' is the terminal state
-- for development mode, where nothing is actually sent.
create type public.sms_status as enum (
  'queued', 'logged', 'sent', 'delivered', 'failed', 'undelivered'
);

-- Discriminated result of an acceptance attempt. The application maps each
-- value to a specific piece of user-facing copy.
create type public.accept_result as enum (
  'accepted',
  'already_filled',
  'not_eligible',
  'offer_expired',
  'offer_invalid',
  'job_not_open'
);

-- Shared trigger body for updated_at bookkeeping.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
