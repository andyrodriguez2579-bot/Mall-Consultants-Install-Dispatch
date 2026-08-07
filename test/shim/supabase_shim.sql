-- =============================================================================
-- Supabase platform shim -- TEST HARNESS ONLY. Never applied to a real project.
-- =============================================================================
-- Recreates the minimum of the hosted Supabase platform that the migrations in
-- supabase/migrations depend on, so that identical SQL can be applied to a
-- plain PostgreSQL cluster and exercised by the test suite.
--
-- On a real Supabase project all of this already exists and is managed by the
-- platform, which is why it lives here rather than in the migrations directory.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

create extension if not exists "pgcrypto" with schema extensions;

-- Supabase's three API roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches the hosted platform: the service role bypasses RLS entirely.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema storage    to anon, authenticated, service_role;
grant usage on schema auth       to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth.users
--
-- Column names, types and defaults mirror the hosted GoTrue table closely
-- enough that supabase/seed.sql runs unmodified against either one.
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  instance_id        uuid default '00000000-0000-0000-0000-000000000000',
  id                 uuid primary key default extensions.gen_random_uuid(),
  aud                varchar(255) default 'authenticated',
  role               varchar(255) default 'authenticated',
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  phone              text unique,
  phone_confirmed_at timestamptz,
  confirmation_token varchar(255) default '',
  recovery_token     varchar(255) default '',
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_super_admin     boolean default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.role() / auth.jwt()
--
-- Identical in behaviour to the hosted helpers: they read the request's JWT
-- claims out of a per-transaction GUC. Tests impersonate a user with
--   set local role authenticated;
--   set local request.jwt.claim.sub = '<uuid>';
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user::text
  );
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage.buckets / storage.objects / storage.foldername()
-- ---------------------------------------------------------------------------
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default extensions.gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Returns the folder segments of an object name, excluding the filename --
-- matching the hosted implementation, which the storage policies rely on.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;

-- Table privileges. RLS then narrows these down per policy; on the hosted
-- platform PostgREST issues the equivalent grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
