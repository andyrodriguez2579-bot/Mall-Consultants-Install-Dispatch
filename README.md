# Mall Consultants Install Dispatch

Private job-dispatch system for SSDC installations and other field work.

An install request arrives as free text. It is extracted into a draft job,
priced from a contractor price list, and dispatched to eligible approved
contractors by SMS. **The first eligible contractor to accept is assigned the
job** — and exactly one can win, guaranteed at the database level. On
acceptance the full work order is released. The contractor completes the work,
records the field ticket number from the existing ticket app, and the job is
approved and scheduled into the next Friday payment run.

---

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Data model](#data-model)
- [The single-winner guarantee](#the-single-winner-guarantee)
- [Security model](#security-model)
- [Local setup](#local-setup)
- [Supabase setup](#supabase-setup)
- [Twilio setup](#twilio-setup)
- [Deploying to Vercel](#deploying-to-vercel)
- [Tests](#tests)
- [Seeded accounts](#seeded-accounts)
- [Deliberate limitations](#deliberate-limitations)

---

## How it works

```mermaid
sequenceDiagram
    participant A as Administrator
    participant S as Dispatch system
    participant C1 as Contractor A
    participant C2 as Contractor B

    A->>S: Paste install request as received
    S-->>A: Extracted draft + suggested work items
    A->>S: Correct, price from the price list, save
    A->>S: Select contractors, open dispatch round
    S-->>C1: SMS with a link unique to Contractor A
    S-->>C2: SMS with a link unique to Contractor B

    Note over C1,C2: Offer shows scope, approximate<br/>location and the fixed pay only

    par Both tap at once
        C1->>S: Accept
    and
        C2->>S: Accept
    end

    S-->>C1: "Job is yours" + full work order
    S-->>C2: "Job already filled"
    S-->>A: "Contractor A accepted MID-2026-1003"

    C1->>S: Confirm arrival, start work
    C1->>S: Field ticket number + completion notes
    A->>S: Reconcile against the ticket app, approve
    S-->>C1: "Approved — payment Friday 24 Apr"
    A->>S: Record Friday payment run
    S-->>C1: "Payment sent"
```

### The four things this system is responsible for

| | |
| --- | --- |
| **Intake** | Turn a pasted request into a priced, dispatchable job |
| **Dispatch** | Broadcast it and produce exactly one assignee |
| **Release** | Hand the winner the full work order, and nobody else |
| **Payment tracking** | Know what is owed to whom, and on which Friday |

Invoicing the customer, and moving the money, both happen outside this system.

### Job statuses

`Draft` → `Ready` → `Offered` → `Assigned` → `In Progress` → `Completed` →
`Approved` → `Paid`

with `Needs Rework` (back to the contractor), `On Hold`, `Cancelled`, and
`Unfilled` (every offer expired or was passed) as the exceptional states.

---

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15, App Router, React 19, TypeScript strict |
| Data | Supabase Postgres, row-level security on every table |
| Auth | Supabase Auth — password for admins, SMS magic link for contractors |
| Files | Supabase Storage, three private buckets, short-lived signed URLs |
| SMS | Twilio REST API, with a development driver that sends nothing |
| Hosting | Vercel, including a cron for the offer-expiry sweep |
| Styling | Tailwind CSS v4, mobile-first |

### Where the rules live

Business rules are enforced **in the database**, not in the application:

- State transitions run through `SECURITY DEFINER` functions that re-check
  ownership and current status server-side.
- Contractors hold no `UPDATE` privilege on `jobs` at all.
- Contractor pay is frozen by trigger the moment a job is dispatched.
- The audit log is append-only, enforced by trigger — no code path, and no
  administrator, can rewrite history.

This means a bug in a route handler cannot corrupt a job, and a second client
(a mobile app, a script, a future integration) inherits the same guarantees for
free.

```
src/
  app/
    sign-in/                     Admin password + contractor SMS link
    auth/link/[token]/           Redeems a single-use sign-in token
    offer/[token]/               The SMS offer page — accept, pass, ask
    (contractor)/
      jobs/                      Offers, assigned work, on-site flow
      account/                   Availability, skills, service areas, SMS prefs
    admin/
      jobs/                      Post, edit, dispatch, review, pay
      contractors/               Roster, approval, certifications, notes
      messages/  activity/       SMS log, audit trail
      export/                    CSV for jobs and payments
    api/
      cron/expire-offers/        Scheduled sweep
      twilio/status/             Delivery-status webhook (signature verified)
  lib/
    dispatch.ts                  Opening rounds, notification fan-out
    offers.ts                    Reading an offer from its token
    passwordless.ts              Token → real Supabase session exchange
    sms/                         Driver interface, Twilio, dev, templates
supabase/
  migrations/                    0001–0010, applied in order
  seed.sql                       One admin, six contractors, six jobs
test/
  concurrency.test.mjs           Simultaneous acceptance
  permissions.test.mjs           RLS and eligibility
  workflow.test.mjs              Full lifecycle
  shim/supabase_shim.sql         Supabase platform shim for local Postgres
```

---

## Pricing

Contractor pay is derived from the **customer** labor price, never entered
directly:

```
Base Labor Total      = Customer Labor Price x Number of Tasks
Total Labor Revenue   = Base Labor Total + Additional Approved Labor
Contractor Labor Pay  = Total Labor Revenue x 45%
Mall Consultants      = Total Labor Revenue - Contractor Labor Pay
Payable Miles         = max(0, Contractor Miles - Excluded/Commuter Miles)
Mileage Payment       = Payable Miles x Mileage Rate
Total Contractor Pay  = Labor Pay + Mileage + Reimbursable Expenses
Total Customer Charge = Total Labor Revenue + Mileage + Expenses
```

Two rules are load-bearing, and both are enforced by generated columns in the
database rather than by application code:

1. **The Mall Consultants share is revenue minus contractor pay**, never its own
   55% multiplication. Two independently rounded percentages disagree with the
   total by a cent on odd amounts; subtraction cannot. `test/pricing.test.mjs`
   asserts the shares reconcile across a spread of awkward figures.
2. **The split never touches mileage or reimbursables.** Those pass to the
   contractor whole and are added after it.

The percentages, the mileage rate and the commuter deduction are administrator
settings (Admin → Settings), not code. Every job snapshots the percentage and
rate it was quoted at, so changing a setting can never reprice work already
accepted.

### Who sees what

The customer price and the Mall Consultants share live in a separate table,
`job_pricing`, which has **no contractor-facing row-level policy at all**. That
is the whole mechanism — not a matter of omitting columns from a query, which a
future change could forget to do.

| Contractor sees | Administrator sees |
| --- | --- |
| Service type, scope, location, schedule | Everything left, plus: |
| Their labor pay | Customer labor price, number of tasks |
| Mileage payment and payable miles | Total labor revenue |
| Approved expense allowance | Contractor % and Mall Consultants share |
| Total expected payment | Total customer charge and margin |

A live TypeScript calculator (`src/lib/pricing.ts`) drives the form previews.
`test/pricing-parity.test.mjs` checks it against the SQL across 252 input
combinations, so the number an administrator approves is always the number the
database stores.

## Intake

**Intake.** Paste the request into Admin → Requests exactly as it arrived. The
parser reads labelled fields ("Customer:", "PO#:", "Date:"), and falls back to
shape — a US address, a phone number, a ZIP — when a request is loose prose. It
then matches the text against the price list to suggest work items and
quantities, so "replace 2 SSDC units" arrives pre-priced.

Two rules govern it:

- **It never guesses silently.** Every extracted value carries the text it came
  from, and the review screen marks whether it was *read from the request* or
  *inferred*. Anything it could not fill is listed explicitly.
- **The raw text is kept verbatim.** When a job is disputed, the original
  request is the record of what was actually asked for.

This is deliberately not an LLM call — it runs on every paste, needs no API key,
and fails predictably. Messy prose will defeat it, which is exactly why the
output is a draft for review rather than a finished job. If you would rather it
handled arbitrary prose, the swap point is one function:
`parseInstallRequest()` in `src/lib/intake/parse.ts`.

**Pricing.** A job's contractor payment is normally built from the price list:
pick work items and quantities, and the total follows. Each line keeps its own
copy of the description and rate, so **re-pricing the catalogue never changes a
job that has already been offered or paid**. An unusual job can be priced by
hand, but that is an explicit override requiring a reason, and it is logged.

Once a job is dispatched, both the total and its work items are frozen by
database trigger.

## Data model

Nineteen tables. The ones that carry the most weight:

**`jobs`** — everything about a job, including its fixed
`contractor_pay_cents`, its schedule, its assignee, and the timestamps for
every lifecycle transition. Constraints make illegal states unrepresentable:
an assignment is always a `(contractor, timestamp)` pair or neither, a job
cannot be `paid` without having been `approved`, and any status from `assigned`
onward requires an actual assignee.

**`job_offers`** — one row per (job, contractor, dispatch round). Holds the
SHA-256 of the link token, the expiry, delivery state, and the response. This
table is the *only* way a contractor learns a job exists.

**`audit_log`** — append-only. Written by database triggers on status changes,
assignments, repricing attempts and payments, so the trail cannot be bypassed
by a code path that forgets to log.

**`sms_messages`** — every outbound message, written *before* the provider is
called, so a crash mid-send still leaves evidence.

**`job_line_items`** — the priced work making up a job. Carries its own
description and unit price rather than pointing at the catalogue, and the job's
total is recomputed from it by trigger.

**`install_requests`** — the raw request text, the extraction, and the job it
became. Admin-only; contractors never see intake.

Supporting: `profiles`, `contractors`, `contractor_notes` (admin-only, split
into its own table so RLS can hide it), `skills`, `contractor_skills`,
`job_skills`, `service_areas`, `contractor_service_areas`,
`contractor_documents`, `job_attachments`, `login_tokens`,
`price_list_items`.

---

## The single-winner guarantee

This is the part of the system that has to be right.

`accept_offer_core()` funnels every competing acceptance for a job through a
`SELECT … FOR UPDATE` on that job's row:

```sql
select * into v_job from public.jobs j where j.id = v_offer.job_id for update;
```

The first transaction to arrive takes the lock and flips the status to
`assigned`. Every other transaction blocks there. Under `READ COMMITTED`, a
blocked statement re-reads the row once the lock clears, so the losers observe
the winner's committed status and fall through to `already_filled`.

The guarded `UPDATE` that follows is a **second, independent barrier**:

```sql
update public.jobs j
   set status = 'assigned', assigned_contractor_id = v_offer.contractor_id, ...
 where j.id = v_job.id
   and j.status = 'offered'
   and j.assigned_contractor_id is null;
```

Its `WHERE` clause matches only an unassigned, still-offered job, so even if
the lock reasoning were wrong, at most one statement can report a row count of
1. Both paths into acceptance — the SMS link and the signed-in job list — call
this same function body, so the guarantee cannot hold on one and not the other.

Before any of that, the function checks that the contractor is **active**,
**approved**, and holds **every skill the job requires**, and that neither the
offer nor the job's dispatch window has expired.

This is not asserted, it is tested — see [Tests](#tests) for the 16-way race,
the ten consecutive races, and the in-app equivalent.

---

## Security model

**Offer links.** 256 bits of entropy, base64url encoded, unique per contractor
per round. Only the SHA-256 is stored, so a database leak yields no working
links. Job pages are UUID-addressed and RLS-gated — there are no guessable job
URLs. The `/offer/*` routes send `noindex` and `no-referrer`.

**Passwordless sign-in.** The SMS link carries our own single-use, expiring
token. The server verifies it and then mints a *genuine* Supabase session via
the admin API. That matters: row-level security keys off the JWT, so a
hand-rolled session cookie would force every query to run as the service role
and RLS would protect nothing.

**Row-level security.** Default-deny on all fifteen tables. A contractor can
see a job only when it is assigned to them or has been offered to them. They
cannot see the competing roster, the audit log, outbound SMS, or the internal
notes written about them. Nobody reads `login_tokens` — not even an
administrator.

**Privilege separation.** The service-role key is used in exactly three places,
all of which genuinely have no user session to act under: verifying a sign-in
token, writing dispatch offers and SMS records, and the expiry sweep. Route
protection lives in pages and RLS rather than middleware, because middleware
runs before the app knows anything about the user.

**Storage.** All three buckets are private. Images are served through signed
URLs valid for ten minutes; a link copied out of the page stops working.
Authorization is by path — the first folder segment is the job or contractor
id, which the storage policies check.

**Webhooks.** The Twilio status callback verifies the `X-Twilio-Signature`
HMAC before touching delivery history.

---

## Local setup

Requires **Node 20.9+** and a **Supabase project** (free tier is fine).

```bash
git clone https://github.com/andyrodriguez2579-bot/Mall-Consultants-Install-Dispatch.git
cd Mall-Consultants-Install-Dispatch
npm install

cp .env.example .env.local
# Fill in the three Supabase values. Leave the Twilio block empty.

npm run dev
```

Open http://localhost:3000.

With `SMS_DRIVER=dev` (the default), **no Twilio account is needed**. Every
message is printed to the terminal with its secure link, so you can dispatch a
job in one window and paste the offer link into another to accept it:

```
┌────────────────────────────────────────────────────────────────
│ SMS (development mode — not sent)
│ To: +17135550201
├────────────────────────────────────────────────────────────────
│ Mall Consultants: new job MID-2026-1007
│ SSDC retrofit — Galleria corridor C
│ Houston, TX · Apr 20 · $680
│ First to accept gets it. Expires in 4h.
│ http://localhost:3000/offer/xQ8f2…
└────────────────────────────────────────────────────────────────
```

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).

2. Apply the migrations, in order. With the CLI:

   ```bash
   npm install -g supabase
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   Or paste each file from `supabase/migrations/` into the SQL Editor in
   filename order, `0001` through `0010`.

3. Load the sample data (development projects only):

   ```bash
   supabase db execute --file supabase/seed.sql
   ```

4. Confirm the three private storage buckets exist — `job-photos`,
   `job-briefs`, `contractor-docs`. Migration `0009` creates them. **Leave them
   private**; the application signs URLs on demand.

5. Copy the URL, anon key and service-role key from Project Settings → API into
   `.env.local`.

### Creating the first administrator on a clean project

The seed file includes one, but for a production project:

```sql
-- 1. Create the auth user in Authentication -> Users (email + password), then:
insert into public.profiles (id, role, full_name, phone, email, is_active)
values ('<the-new-user-uuid>', 'admin', 'Your Name', '+15125550100', 'you@example.com', true);
```

Contractors are then added from **Admin → Contractors → Add a contractor**,
which creates the auth user and profile together.

---

## Twilio setup

Only needed to send real messages.

1. Buy a number, or create a Messaging Service (preferred — it handles number
   pooling and compliance).
2. Set in your environment:

   ```
   SMS_DRIVER=twilio
   TWILIO_ACCOUNT_SID=AC…
   TWILIO_AUTH_TOKEN=…
   TWILIO_MESSAGING_SERVICE_SID=MG…      # or TWILIO_FROM_NUMBER=+1…
   ```

3. For delivery confirmation, set the status callback on the Messaging Service
   or number to:

   ```
   https://your-domain.com/api/twilio/status
   ```

   Without it the message log tops out at "sent"; with it you get `delivered`,
   `undelivered` and `failed` per recipient, reflected on the offers table.

US A2P 10DLC registration is required before Twilio will deliver application
traffic to US numbers. Register the brand and campaign in the Twilio console
first, or messages will be filtered.

---

## Deploying to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new). Framework
   preset and build settings are detected automatically.

2. Add environment variables (Project Settings → Environment Variables):

   | Variable | Notes |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Mark as sensitive** |
   | `APP_BASE_URL` | Your production URL, e.g. `https://dispatch.example.com` |
   | `SMS_DRIVER` | `twilio` in production |
   | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Mark the token as sensitive |
   | `TWILIO_MESSAGING_SERVICE_SID` *or* `TWILIO_FROM_NUMBER` | |
   | `OFFER_TTL_HOURS` | Optional, defaults to 4 |
   | `CRON_SECRET` | `openssl rand -base64 32` |

   `APP_BASE_URL` matters: it is what offer links point at. Without it, links
   fall back to the per-deployment `VERCEL_URL` and will not match your domain.

3. Deploy. `vercel.json` registers the expiry sweep at `0 13 * * *`; Vercel
   supplies the `CRON_SECRET` as a bearer token automatically.

   Once daily is the most a Vercel Hobby account permits — anything more
   frequent is rejected when the deployment is created, not at run time, so an
   over-eager schedule blocks the whole deploy rather than degrading. On a paid
   plan, tighten it to `*/15 * * * *` so the dashboard reflects expiry sooner.

4. In Supabase → Authentication → URL Configuration, add your production domain
   to the redirect allow-list.

5. Point Twilio's status callback at the deployed URL.

> The expiry sweep is a convenience, not a safety net. Expiry is re-checked on
> every acceptance attempt, so a missed cron run can never let a stale offer be
> accepted — it only leaves the dashboard looking out of date.

---

## Tests

The suite runs against a **real PostgreSQL cluster**, not a mock. A local
cluster is created on demand and the *same* migration files that ship to
Supabase are applied on top of a small shim that recreates the platform pieces
they depend on (the `auth` and `storage` schemas, the `anon` / `authenticated`
/ `service_role` roles).

```bash
npm test          # rebuild the database, then run everything
npm run test:only # run against the current database
npm run db:psql   # open a psql session against it
```

92 tests:

**Concurrency (7)** — three-way and 16-way simultaneous races; ten consecutive
races, because a lost update is a timing bug and one clean pass proves little;
losing offers marked `filled`; late acceptance reporting "Job already filled";
the winner re-tapping their own link treated as idempotent rather than an
error; exactly one acceptance in the audit log per race.

**Permissions (35)** — job visibility per role; contractors holding no write
path to `jobs`; self-promotion and self-approval refused; the competing roster,
audit log, SMS records and internal notes all invisible; login tokens invisible
to everyone; every eligibility gate on acceptance (unqualified, pending,
suspended, deactivated, expired, another contractor's link); audit-log
immutability; pay immutability after dispatch; job numbers immutable; approval
and payment ordering enforced.

**Workflow (10)** — the full lifecycle from dispatch through payment; the
rework loop; the in-app acceptance race; the expiry sweep; re-offering in a
second round; cancellation closing out live offers; reassignment revoking the
previous contractor's access; pay staying fixed at every stage.

**Pricing and payment (23)** — totals following their work items, including
fractional quantities; re-pricing or retiring a catalogue item leaving existing
jobs untouched; work items frozen at dispatch; overrides requiring a reason and
being logged; `next_friday()` across every day of the week; approval scheduling
a pay date; payment runs being all-or-nothing; intake staying invisible to
contractors.

**Intake extraction (17)** — structured work orders read field by field; loose
emails still yielding an address and phone; quantities in digits,
parentheses and words; specific work items outranking general ones; a street
number not being mistaken for a quantity; impossible dates left blank rather
than invented.

The races are genuinely parallel — N independent connections, all warmed
first so connection setup cannot stagger the calls and quietly serialise the
very thing under test.

---

## Seeded accounts

`supabase/seed.sql`, development only. Password for every account:
`DispatchDev!2026`

| Who | Sign in with | Standing |
| --- | --- | --- |
| Renee Alvarado (admin) | `admin@macaconsultants.test` | — |
| Marcus Webb | `+1 713 555 0201` | Approved, SSDC certified |
| Dana Ortiz | `+1 713 555 0202` | Approved, SSDC certified |
| Priya Raman | `+1 214 555 0203` | Approved, all certifications |
| Tom Beckett | `+1 713 555 0204` | Approved, **not** SSDC certified |
| Alicia Nunez | `+1 713 555 0205` | **Pending** approval |
| Ray Coleman | `+1 602 555 0206` | **Suspended** |

The last three exist to make the eligibility rules easy to see: Tom can hold an
offer but cannot accept an SSDC job, and Alicia and Ray cannot accept anything.

Job `MID-2026-1003` ships with four live offers whose links are reproducible:

```
/offer/seed-offer-marcus-development-only-do-not-reuse
/offer/seed-offer-dana-development-only-do-not-reuse
/offer/seed-offer-priya-development-only-do-not-reuse
/offer/seed-offer-tom-development-only-do-not-reuse
```

Open the first two in different browsers and race them — one gets the job, the
other gets "Job already filled". Open Tom's to see the eligibility gate refuse
an approved but uncertified contractor.

---

## Deliberate limitations

Worth knowing before this goes near production:

- **Payment is recorded, not processed.** No payment rail is integrated.
  Recording a Friday run writes the ledger entries and texts each contractor;
  it does not move money. The amount always comes from the job's frozen pay
  rather than from operator input, so the register cannot disagree with what
  the contractor accepted.

- **Proof of completion lives in the other app.** Contractors record the field
  ticket number here; the ticket itself is the evidence. Photos in this system
  are optional supporting material. Nothing verifies that a ticket number is
  real — reconciling it against the ticket app is a human step, which is why
  the number is shown prominently on the approval screen.

- **Customer pricing is not modelled.** The system tracks only what the
  contractor is owed, since invoicing happens outside it. If you later want
  margin per job, the change is a `customer_price_cents` column on `jobs` plus
  an RLS policy keeping it away from contractors — the pattern already exists
  for `contractor_notes`.

- **Pay dates are computed in UTC.** `next_friday()` uses the database's
  timezone, which on Supabase is UTC. A job approved late on a Thursday evening
  US-time may schedule into the following Friday. Set the database timezone if
  that matters.

- **Extraction is pattern-based.** It handles labelled work orders well and
  loose prose adequately. It will not understand an unusual request, and is
  built to leave fields blank rather than fill them wrongly.

- **Contractors self-report their certifications.** The spec lists skills under
  contractor self-service, so `contractor_skills` is writable by its owner. That
  makes the qualification gate an honesty check backed by the documents on file,
  not a hard credential. If you would rather it were hard, remove the
  `contractor_skills_self_write` policy in migration `0008` and manage skills
  from the admin side only — everything else keeps working.

- **Service areas inform matching, they do not gate acceptance.** Skills are the
  hard requirement; geography is advisory, so an admin can always dispatch
  outside a contractor's declared area.

- **No offline mode.** A contractor in a basement plant room with no signal
  cannot upload photos. The camera capture works; the upload needs a connection.

- **`match_contractors_for_job` is unpaginated.** Fine to a few hundred
  contractors. Past that, add paging and a distance calculation rather than
  postal-prefix matching.
