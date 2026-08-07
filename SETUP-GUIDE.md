# Getting this running — plain English

No coding. Two free websites. About 20 minutes.

You'll do **Supabase first** (that's the filing cabinet where all the data lives),
then **Vercel** (that's what puts the website on the internet).

Do them in that order. Vercel needs three "keys" that Supabase gives you.

---

## Part 1 — Supabase (the database)

### Step 1. Make an account

Go to **https://supabase.com** → click **Start your project** → sign in with GitHub.

### Step 2. Make a project

Click **New project**.

- **Name:** `maca-install-dispatch`
- **Database Password:** click Generate, then **copy it and save it somewhere**
  (a note on your phone is fine). You probably won't need it, but you can't get
  it back later.
- **Region:** pick the one closest to you.

Click **Create new project** and wait about 2 minutes while it builds.

### Step 3. Build the tables

In the left sidebar click **SQL Editor**, then **New query**.

Open this file from the repo: **`supabase/setup.sql`**

Select all of it, copy it, paste it into the big empty box in Supabase, and
click **Run** (bottom right).

It should say **Success. No rows returned.** That's what you want.

> This one file creates all 20 tables, every security rule, the pricing
> calculator, and loads your 105-item price list.

### Step 4. Make your login

Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.

- **Email:** your real email
- **Password:** pick one you'll remember
- Tick **Auto Confirm User** ✅ (important — without it you can't log in)

Click **Create user**.

Now you'll see the new user in the list. **Click on it** and copy the long
**User UID** at the top (looks like `a1b2c3d4-5e6f-...`).

### Step 5. Make yourself the administrator

Back to **SQL Editor** → **New query**. Paste this in, but **replace the two
things in quotes** with your UID and your name:

```sql
insert into public.profiles (id, role, full_name, email, is_active)
values (
  'PASTE-YOUR-USER-UID-HERE',
  'admin',
  'Andy Rodriguez',
  'your@email.com',
  true
);
```

Click **Run**. Should say Success.

### Step 6. Copy your three keys

Left sidebar → **Project Settings** (gear icon) → **API**.

You need three things. Keep this tab open — you'll paste them into Vercel next.

| What it's called there | What we call it |
| --- | --- |
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` |
| **anon** / **public** key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role** key (click Reveal) | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The **service_role** key is the master key to everything. Don't email it,
> don't put it in a chat, don't paste it into a document. It only ever goes in
> the Vercel box in Part 2.

**Supabase is done.** ✅

---

## Part 2 — Vercel (putting it on the internet)

### Step 1. Make an account

Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub**.

### Step 2. Import the project

Click **Add New…** → **Project**.

Find **Mall-Consultants-Install-Dispatch** in the list → click **Import**.

> If you don't see it, click **Adjust GitHub App Permissions** and give Vercel
> access to that repository.

### Step 3. Pick the right branch ⚠️

This one matters. On the import screen, look for a **Git Branch** dropdown.

Change it from `main` to:

```
claude/new-repo-setup-fgbjlh
```

*(All the code is on that branch. `main` is empty, so if you leave it on `main`
the deploy will fail.)*

### Step 4. Paste in the keys

Expand **Environment Variables** and add these **five**. Name on the left,
value on the right:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | your Project URL from Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key |
| `SMS_DRIVER` | `dev` |
| `OFFER_TTL_HOURS` | `4` |

`SMS_DRIVER=dev` means **no texts get sent yet** — safe for testing. We'll turn
real texting on later.

### Step 5. Deploy

Click **Deploy**. Wait about 2 minutes.

When it's done you'll get a web address like
`maca-install-dispatch.vercel.app`. **That's your app.**

### Step 6. One last setting

In Vercel: **Settings** → **Environment Variables** → add one more:

| Name | Value |
| --- | --- |
| `APP_BASE_URL` | your new address, e.g. `https://maca-install-dispatch.vercel.app` |

Then **Deployments** → the "…" menu on the top one → **Redeploy**.

*(This tells the app its own address, so the links it texts to contractors
point to the right place.)*

**You're live.** ✅

---

## Try it out

1. Go to your address → click the **Administrator** tab → sign in with the
   email and password from Part 1, Step 4.
2. Click **Price list** — your 105 services should be there.
3. Click **Contractors** → **Add a contractor** → put in your own name and
   **your own mobile number**, then **Approve** them.
4. Click **Jobs** → **Post a job** → pick a service, set the tasks, save.
5. Open the job → **Dispatch** → tick yourself → **Send offer**.

Because texting is off, the offer link won't reach your phone yet. To find it:
Supabase → **Table Editor** → **sms_messages** → newest row → the `body` column
has the link. Paste it in a different browser to see what a contractor sees.

---

## When you're ready for real text messages

You'll need a Twilio account (costs about a cent per text).

1. Sign up at **https://twilio.com**, buy a phone number.
2. In Vercel → Settings → Environment Variables, change `SMS_DRIVER` to
   `twilio` and add:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` (the number you bought, like `+15125550100`)
3. Redeploy.

> **Heads up:** to text US numbers, Twilio makes you register your business
> first ("A2P 10DLC"). It's a form in their console and takes a few days to
> approve. Until then texts get blocked. Nothing wrong with the app — it's a
> phone-carrier rule.

---

## Things worth changing once you're in

**Admin → Settings**

- **Contractor percentage** — set to 45 already.
- **Mileage rate** — set to **$0.725**, but your spreadsheet uses **$0.70**.
  Change it if you want to match your sheet.
- **Commuter deduction** — 30 miles, matching your sheet.

**Admin → Price list** — the 105 prices came straight from your zone pricing
workbook. Check a few against the original before you dispatch real work.

---

## If something goes wrong

| What you see | What it means | Fix |
| --- | --- | --- |
| Deploy fails right away | Wrong branch | Vercel → Settings → Git → set branch to `claude/new-repo-setup-fgbjlh` → Redeploy |
| "Invalid Supabase configuration" | A key is missing or has a space in it | Re-copy the keys, no spaces before or after |
| Can't log in | User wasn't confirmed | Supabase → Authentication → your user → make sure it's confirmed |
| Logged in but it kicks you out | Step 5 of Part 1 didn't run | Re-run that SQL with the right UID |
| SQL Editor says "already exists" | Setup already ran | Nothing to fix, it's done |

Send me the error message if you get stuck — not your keys, just the message.
