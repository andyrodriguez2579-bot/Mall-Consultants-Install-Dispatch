-- =============================================================================
-- 0023  Addresses for the two RSMs who send almost everything
-- =============================================================================
--
-- The install sheet names the SSDC rep -- "Chris Medeiros" -- but never gives
-- an address, so the site-readiness email has nowhere to send their copy. The
-- name on the sheet is matched against this roster to find one.
--
-- An update rather than an insert: 0021 seeded the names, and re-inserting
-- would collide with them. Matched case-insensitively because the sheet is
-- typed by hand and "C Medeiros" is how it is written there, while a fuller
-- form turns up elsewhere.
-- ---------------------------------------------------------------------------

update public.rsm_contacts
   set email = 'chris.medeiros@ssdcsoap.com'
 where lower(name) in ('c medeiros', 'chris medeiros', 'c. medeiros');

update public.rsm_contacts
   set email = 'stephen.whalen@ssdcsoap.com'
 where lower(name) in ('s whalen', 'steve whalen', 'stephen whalen', 's. whalen');

-- The sheets write the short form; the roster should answer to the long one
-- too, so a request naming "Chris Medeiros" in full still finds an address.
insert into public.rsm_contacts (name, email, sort_order) values
  ('Chris Medeiros',  'chris.medeiros@ssdcsoap.com',  3),
  ('Stephen Whalen',  'stephen.whalen@ssdcsoap.com',  4)
on conflict (name) do update set email = excluded.email;
