-- =============================================================================
-- Seed data -- DEVELOPMENT AND TEST ONLY
-- =============================================================================
-- One administrator, six contractors spanning every eligibility case, and a set
-- of jobs sitting at different points in the lifecycle.
--
-- The fixed UUIDs and the deterministic offer tokens below are what the test
-- suite asserts against, and what makes the local demo links reproducible.
-- Never run this against a production project.

-- Dev password for every seeded account: DispatchDev!2026
\set dev_password '''DispatchDev!2026'''

begin;

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        phone, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'admin@macaconsultants.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+15125550100', '{"provider":"email","providers":["email"]}', '{"full_name":"Renee Alvarado"}'),

  ('22222222-2222-4222-8222-222222222201', 'authenticated', 'authenticated',
   'marcus.webb@example.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+17135550201', '{"provider":"phone","providers":["phone"]}', '{"full_name":"Marcus Webb"}'),

  ('22222222-2222-4222-8222-222222222202', 'authenticated', 'authenticated',
   'dana.ortiz@example.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+17135550202', '{"provider":"phone","providers":["phone"]}', '{"full_name":"Dana Ortiz"}'),

  ('22222222-2222-4222-8222-222222222203', 'authenticated', 'authenticated',
   'priya.raman@example.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+12145550203', '{"provider":"phone","providers":["phone"]}', '{"full_name":"Priya Raman"}'),

  ('22222222-2222-4222-8222-222222222204', 'authenticated', 'authenticated',
   'tom.beckett@example.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+17135550204', '{"provider":"phone","providers":["phone"]}', '{"full_name":"Tom Beckett"}'),

  ('22222222-2222-4222-8222-222222222205', 'authenticated', 'authenticated',
   'alicia.nunez@example.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+17135550205', '{"provider":"phone","providers":["phone"]}', '{"full_name":"Alicia Nunez"}'),

  ('22222222-2222-4222-8222-222222222206', 'authenticated', 'authenticated',
   'ray.coleman@example.test',
   extensions.crypt(:dev_password, extensions.gen_salt('bf')), now(),
   '+16025550206', '{"provider":"phone","providers":["phone"]}', '{"full_name":"Ray Coleman"}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
insert into public.profiles (id, role, full_name, phone, email, is_active) values
  ('11111111-1111-4111-8111-111111111111', 'admin',      'Renee Alvarado', '+15125550100', 'admin@macaconsultants.test', true),
  ('22222222-2222-4222-8222-222222222201', 'contractor', 'Marcus Webb',    '+17135550201', 'marcus.webb@example.test',   true),
  ('22222222-2222-4222-8222-222222222202', 'contractor', 'Dana Ortiz',     '+17135550202', 'dana.ortiz@example.test',    true),
  ('22222222-2222-4222-8222-222222222203', 'contractor', 'Priya Raman',    '+12145550203', 'priya.raman@example.test',   true),
  ('22222222-2222-4222-8222-222222222204', 'contractor', 'Tom Beckett',    '+17135550204', 'tom.beckett@example.test',   true),
  ('22222222-2222-4222-8222-222222222205', 'contractor', 'Alicia Nunez',   '+17135550205', 'alicia.nunez@example.test',  true),
  ('22222222-2222-4222-8222-222222222206', 'contractor', 'Ray Coleman',    '+16025550206', 'ray.coleman@example.test',   true)
on conflict (id) do nothing;

-- Six contractors covering every branch of the eligibility check:
--   Marcus, Dana, Priya  -- approved and qualified
--   Tom                  -- approved but missing the SSDC certification
--   Alicia               -- fully skilled but still pending approval
--   Ray                  -- previously approved, now suspended
insert into public.contractors (id, status, company_name, is_available, sms_opt_in,
                                max_travel_miles, approved_at, approved_by) values
  ('22222222-2222-4222-8222-222222222201', 'approved',  'Webb Installations LLC', true,  true,  120,
   now() - interval '400 days', '11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222202', 'approved',  'Ortiz Field Services',   true,  true,  80,
   now() - interval '310 days', '11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222203', 'approved',  'Raman Integration Co',   true,  true,  200,
   now() - interval '220 days', '11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222204', 'approved',  'Beckett Low Voltage',    true,  true,  60,
   now() - interval '150 days', '11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222205', 'pending',   'Nunez Contracting',      true,  true,  100,
   null, null),
  ('22222222-2222-4222-8222-222222222206', 'suspended', 'Coleman Installs',       true,  true,  150,
   null, null)
on conflict (id) do nothing;

insert into public.contractor_notes (contractor_id, author_id, body) values
  ('22222222-2222-4222-8222-222222222206', '11111111-1111-4111-8111-111111111111',
   'Suspended pending renewal of general liability coverage. Do not dispatch.'),
  ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111111',
   'Background check clear. Awaiting signed master service agreement.');

-- ---------------------------------------------------------------------------
-- Skills and service areas
-- ---------------------------------------------------------------------------
insert into public.skills (id, slug, name, description) values
  ('33333333-3333-4333-8333-333333333301', 'ssdc-install',  'SSDC Installation',
   'Certified to install and commission SSDC units.'),
  ('33333333-3333-4333-8333-333333333302', 'low-voltage',   'Low Voltage Wiring',
   'Structured cabling and low-voltage terminations.'),
  ('33333333-3333-4333-8333-333333333303', 'fire-alarm',    'Fire Alarm Interface',
   'Licensed to interface with building fire alarm panels.'),
  ('33333333-3333-4333-8333-333333333304', 'lift-certified','Scissor/Boom Lift Certified',
   'Current aerial work platform certification.'),
  ('33333333-3333-4333-8333-333333333305', 'electrical',    'Licensed Electrician',
   'State-licensed electrical work.')
on conflict (id) do nothing;

insert into public.service_areas (id, name, state_code, postal_prefixes) values
  ('44444444-4444-4444-8444-444444444401', 'Houston Metro',      'TX', array['770','771','772','773','774','775']),
  ('44444444-4444-4444-8444-444444444402', 'Dallas-Fort Worth',  'TX', array['750','751','752','760','761']),
  ('44444444-4444-4444-8444-444444444403', 'Phoenix Metro',      'AZ', array['850','852','853'])
on conflict (id) do nothing;

insert into public.contractor_skills (contractor_id, skill_id) values
  -- Marcus: SSDC + low voltage + lift
  ('22222222-2222-4222-8222-222222222201', '33333333-3333-4333-8333-333333333301'),
  ('22222222-2222-4222-8222-222222222201', '33333333-3333-4333-8333-333333333302'),
  ('22222222-2222-4222-8222-222222222201', '33333333-3333-4333-8333-333333333304'),
  -- Dana: SSDC + low voltage
  ('22222222-2222-4222-8222-222222222202', '33333333-3333-4333-8333-333333333301'),
  ('22222222-2222-4222-8222-222222222202', '33333333-3333-4333-8333-333333333302'),
  -- Priya: everything
  ('22222222-2222-4222-8222-222222222203', '33333333-3333-4333-8333-333333333301'),
  ('22222222-2222-4222-8222-222222222203', '33333333-3333-4333-8333-333333333302'),
  ('22222222-2222-4222-8222-222222222203', '33333333-3333-4333-8333-333333333303'),
  ('22222222-2222-4222-8222-222222222203', '33333333-3333-4333-8333-333333333304'),
  ('22222222-2222-4222-8222-222222222203', '33333333-3333-4333-8333-333333333305'),
  -- Tom: low voltage only -- deliberately NOT SSDC certified
  ('22222222-2222-4222-8222-222222222204', '33333333-3333-4333-8333-333333333302'),
  -- Alicia: fully skilled, but her account is still pending
  ('22222222-2222-4222-8222-222222222205', '33333333-3333-4333-8333-333333333301'),
  ('22222222-2222-4222-8222-222222222205', '33333333-3333-4333-8333-333333333302'),
  ('22222222-2222-4222-8222-222222222205', '33333333-3333-4333-8333-333333333304'),
  -- Ray: skilled, but suspended
  ('22222222-2222-4222-8222-222222222206', '33333333-3333-4333-8333-333333333301'),
  ('22222222-2222-4222-8222-222222222206', '33333333-3333-4333-8333-333333333302')
on conflict do nothing;

insert into public.contractor_service_areas (contractor_id, service_area_id) values
  ('22222222-2222-4222-8222-222222222201', '44444444-4444-4444-8444-444444444401'),
  ('22222222-2222-4222-8222-222222222202', '44444444-4444-4444-8444-444444444401'),
  ('22222222-2222-4222-8222-222222222203', '44444444-4444-4444-8444-444444444402'),
  ('22222222-2222-4222-8222-222222222203', '44444444-4444-4444-8444-444444444401'),
  ('22222222-2222-4222-8222-222222222204', '44444444-4444-4444-8444-444444444401'),
  ('22222222-2222-4222-8222-222222222205', '44444444-4444-4444-8444-444444444401'),
  ('22222222-2222-4222-8222-222222222206', '44444444-4444-4444-8444-444444444403')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Jobs, one per interesting lifecycle position
-- ---------------------------------------------------------------------------
insert into public.jobs (
  id, job_number, status, title, customer_name, site_name,
  address_line1, city, state_code, postal_code,
  scope, instructions, contractor_pay_cents,
  scheduled_start, scheduled_end, deadline_at,
  offer_expires_at, offer_round,
  assigned_contractor_id, assigned_at,
  arrival_confirmed_at, started_at, completed_at, completion_notes,
  approved_at, approved_by, paid_at, payment_reference, payment_method, paid_by,
  created_by
) values
  -- 1. Draft -- still being written.
  ('55555555-5555-4555-8555-555555555501', 'MID-2026-1001', 'draft',
   'SSDC retrofit -- Galleria corridor C',
   'Simon Property Group', 'The Galleria',
   '5085 Westheimer Rd', 'Houston', 'TX', '77056',
   'Remove four legacy SSDC units in corridor C and install replacements. Verify network handshake with the BMS head end before leaving site.',
   null, 68000,
   null, null, null, null, 0,
   null, null, null, null, null, null, null, null, null, null, null, null,
   '11111111-1111-4111-8111-111111111111'),

  -- 2. Ready -- fully specified, awaiting dispatch.
  ('55555555-5555-4555-8555-555555555502', 'MID-2026-1002', 'ready',
   'SSDC commissioning -- Baybrook food court',
   'Brookfield Properties', 'Baybrook Mall',
   '500 Baybrook Mall', 'Friendswood', 'TX', '77546',
   'Commission six previously installed SSDC units. Full point-to-point verification and signed commissioning sheet required.',
   'Park in the service lot off Bay Area Blvd. Check in with mall security for badge.',
   94000,
   now() + interval '6 days', now() + interval '6 days 8 hours',
   now() + interval '9 days', null, 0,
   null, null, null, null, null, null, null, null, null, null, null, null,
   '11111111-1111-4111-8111-111111111111'),

  -- 3. Offered -- live dispatch round, nobody has accepted yet. This is the
  --    row the concurrency tests race against.
  ('55555555-5555-4555-8555-555555555503', 'MID-2026-1003', 'offered',
   'Emergency SSDC replacement -- Memorial City',
   'Simon Property Group', 'Memorial City Mall',
   '303 Memorial City Way', 'Houston', 'TX', '77024',
   'Unit 3 in the north vestibule has failed closed. Replace the controller board and re-commission. Replacement hardware is on site at the management office.',
   'Mall engineering will escort. Ask for Danielle at the loading dock.',
   47500,
   now() + interval '1 day', now() + interval '1 day 4 hours',
   now() + interval '2 days', now() + interval '4 hours', 1,
   null, null, null, null, null, null, null, null, null, null, null, null,
   '11111111-1111-4111-8111-111111111111'),

  -- 4. In progress -- Marcus is on site.
  ('55555555-5555-4555-8555-555555555504', 'MID-2026-1004', 'in_progress',
   'SSDC install -- Willowbrook east entry',
   'Brookfield Properties', 'Willowbrook Mall',
   '2000 Willowbrook Mall', 'Houston', 'TX', '77070',
   'Install two SSDC units at the east entry vestibule, including low-voltage runs back to the IDF.',
   null, 82000,
   now() - interval '3 hours', now() + interval '5 hours', now() + interval '1 day',
   null, 1,
   '22222222-2222-4222-8222-222222222201', now() - interval '2 days',
   now() - interval '3 hours', now() - interval '3 hours',
   null, null, null, null, null, null, null, null,
   '11111111-1111-4111-8111-111111111111'),

  -- 5. Completed -- awaiting administrator review.
  ('55555555-5555-4555-8555-555555555505', 'MID-2026-1005', 'completed',
   'SSDC panel swap -- Deerbrook',
   'Brookfield Properties', 'Deerbrook Mall',
   '20131 Highway 59 N', 'Humble', 'TX', '77338',
   'Swap the failed SSDC panel at the center court entrance and verify alarm interface.',
   null, 55000,
   now() - interval '2 days', now() - interval '2 days' + interval '6 hours',
   now() - interval '1 day', null, 1,
   '22222222-2222-4222-8222-222222222202', now() - interval '4 days',
   now() - interval '2 days', now() - interval '2 days',
   now() - interval '2 days' + interval '6 hours',
   'Panel swapped and alarm interface verified with mall engineering. Old panel left in the management office as requested.',
   null, null, null, null, null, null,
   '11111111-1111-4111-8111-111111111111'),

  -- 6. Paid -- a closed-out job, for reporting and CSV export.
  ('55555555-5555-4555-8555-555555555506', 'MID-2026-1006', 'paid',
   'SSDC install -- Stonebriar north wing',
   'Simon Property Group', 'Stonebriar Centre',
   '2601 Preston Rd', 'Frisco', 'TX', '75034',
   'Install three SSDC units in the north wing and commission against the BMS.',
   null, 118000,
   now() - interval '20 days', now() - interval '20 days' + interval '9 hours',
   now() - interval '18 days', null, 1,
   '22222222-2222-4222-8222-222222222203', now() - interval '24 days',
   now() - interval '20 days', now() - interval '20 days',
   now() - interval '20 days' + interval '9 hours',
   'All three units installed and commissioned. BMS points verified with the customer.',
   now() - interval '19 days', '11111111-1111-4111-8111-111111111111',
   now() - interval '12 days', 'ACH-2026-0418', 'ACH',
   '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- Keep the human-readable numbering ahead of the seeded rows.
select setval('public.job_number_seq', 1006, true);

insert into public.job_skills (job_id, skill_id) values
  ('55555555-5555-4555-8555-555555555501', '33333333-3333-4333-8333-333333333301'),
  ('55555555-5555-4555-8555-555555555502', '33333333-3333-4333-8333-333333333301'),
  -- The raced job requires SSDC certification, which is what makes Tom
  -- ineligible even though he holds a live offer.
  ('55555555-5555-4555-8555-555555555503', '33333333-3333-4333-8333-333333333301'),
  ('55555555-5555-4555-8555-555555555504', '33333333-3333-4333-8333-333333333301'),
  ('55555555-5555-4555-8555-555555555504', '33333333-3333-4333-8333-333333333302'),
  ('55555555-5555-4555-8555-555555555505', '33333333-3333-4333-8333-333333333301'),
  ('55555555-5555-4555-8555-555555555506', '33333333-3333-4333-8333-333333333301')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Live offers on the 'offered' job.
--
-- Tokens are derived deterministically from a readable string so local demo
-- links are reproducible. Only the SHA-256 is stored, exactly as in production;
-- the raw token for contractor X is 'seed-offer-<name>'.
--   Marcus -> /offer/seed-offer-marcus
--   Dana   -> /offer/seed-offer-dana
--   Priya  -> /offer/seed-offer-priya
--   Tom    -> /offer/seed-offer-tom      (approved, but not SSDC certified)
-- ---------------------------------------------------------------------------
insert into public.job_offers (job_id, contractor_id, round, status, token_hash, expires_at, sent_at)
values
  ('55555555-5555-4555-8555-555555555503', '22222222-2222-4222-8222-222222222201', 1, 'delivered',
   encode(extensions.digest('seed-offer-marcus', 'sha256'), 'hex'), now() + interval '4 hours', now() - interval '10 minutes'),
  ('55555555-5555-4555-8555-555555555503', '22222222-2222-4222-8222-222222222202', 1, 'delivered',
   encode(extensions.digest('seed-offer-dana', 'sha256'), 'hex'),   now() + interval '4 hours', now() - interval '10 minutes'),
  ('55555555-5555-4555-8555-555555555503', '22222222-2222-4222-8222-222222222203', 1, 'sent',
   encode(extensions.digest('seed-offer-priya', 'sha256'), 'hex'),  now() + interval '4 hours', now() - interval '10 minutes'),
  ('55555555-5555-4555-8555-555555555503', '22222222-2222-4222-8222-222222222204', 1, 'delivered',
   encode(extensions.digest('seed-offer-tom', 'sha256'), 'hex'),    now() + interval '4 hours', now() - interval '10 minutes')
on conflict do nothing;

-- Historical offers for the jobs that were already won.
insert into public.job_offers (job_id, contractor_id, round, status, token_hash, expires_at, sent_at, responded_at)
values
  ('55555555-5555-4555-8555-555555555504', '22222222-2222-4222-8222-222222222201', 1, 'accepted',
   encode(extensions.digest('seed-offer-hist-1', 'sha256'), 'hex'), now() - interval '2 days', now() - interval '3 days', now() - interval '2 days'),
  ('55555555-5555-4555-8555-555555555504', '22222222-2222-4222-8222-222222222202', 1, 'filled',
   encode(extensions.digest('seed-offer-hist-2', 'sha256'), 'hex'), now() - interval '2 days', now() - interval '3 days', now() - interval '2 days'),
  ('55555555-5555-4555-8555-555555555505', '22222222-2222-4222-8222-222222222202', 1, 'accepted',
   encode(extensions.digest('seed-offer-hist-3', 'sha256'), 'hex'), now() - interval '4 days', now() - interval '5 days', now() - interval '4 days'),
  ('55555555-5555-4555-8555-555555555506', '22222222-2222-4222-8222-222222222203', 1, 'accepted',
   encode(extensions.digest('seed-offer-hist-4', 'sha256'), 'hex'), now() - interval '24 days', now() - interval '25 days', now() - interval '24 days')
on conflict do nothing;

-- Completion evidence for the job awaiting review, so the approval screen has
-- something real to show.
insert into public.job_attachments (job_id, kind, file_path, file_name, content_type, size_bytes, caption, uploaded_by)
values
  ('55555555-5555-4555-8555-555555555505', 'before',
   '55555555-5555-4555-8555-555555555505/seed-before-1.jpg', 'before-1.jpg', 'image/jpeg', 812345,
   'Failed panel prior to removal', '22222222-2222-4222-8222-222222222202'),
  ('55555555-5555-4555-8555-555555555505', 'after',
   '55555555-5555-4555-8555-555555555505/seed-after-1.jpg', 'after-1.jpg', 'image/jpeg', 903221,
   'Replacement panel installed and labelled', '22222222-2222-4222-8222-222222222202'),
  ('55555555-5555-4555-8555-555555555506', 'after',
   '55555555-5555-4555-8555-555555555506/seed-after-1.jpg', 'after-1.jpg', 'image/jpeg', 774102,
   'North wing units commissioned', '22222222-2222-4222-8222-222222222203')
on conflict do nothing;

commit;
