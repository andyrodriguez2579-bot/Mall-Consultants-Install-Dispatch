/**
 * Permission tests.
 *
 * Every case here runs through the `authenticated` role with a JWT claim set,
 * which is exactly how a request arriving from the browser reaches Postgres.
 * A policy that looks right but grants too much will fail here rather than in
 * production.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ID,
  CONTRACTOR,
  SKILL,
  asAnon,
  asUser,
  closePool,
  createOfferedJob,
  getJob,
  query,
  sha256,
} from "./helpers/db.mjs";

const SEED_OFFERED_JOB = "55555555-5555-4555-8555-555555555503";
const SEED_DRAFT_JOB = "55555555-5555-4555-8555-555555555501";
const SEED_ASSIGNED_JOB = "55555555-5555-4555-8555-555555555504";

// ---------------------------------------------------------------------------
// Job visibility
// ---------------------------------------------------------------------------

test("a contractor cannot see a job that was never offered to them", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.jobs where id = $1", [SEED_DRAFT_JOB]).then((r) => r.rows),
  );
  assert.equal(rows.length, 0, "draft jobs must not leak to contractors");
});

test("a contractor can see a job that was offered to them", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.jobs where id = $1", [SEED_OFFERED_JOB]).then((r) => r.rows),
  );
  assert.equal(rows.length, 1);
});

test("a contractor can see the job assigned to them", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id, status from public.jobs where id = $1", [SEED_ASSIGNED_JOB]).then((r) => r.rows),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "in_progress");
});

test("a contractor's job list is their own work plus the open board", async () => {
  const rows = await asUser(CONTRACTOR.tom, (c) =>
    c
      .query(
        `select id, board_posted_at, assigned_contractor_id, status
           from public.jobs`,
      )
      .then((r) => r.rows),
  );

  // Tom holds exactly one live offer in the seed. Since the board opened, he
  // can also see work standing on it -- so the property worth asserting is not
  // a count but that nothing else gets through: every other row he can read
  // must be posted, unclaimed, and open.
  assert.ok(
    rows.some((r) => r.id === SEED_OFFERED_JOB),
    "the job he was offered is visible",
  );

  for (const row of rows) {
    if (row.id === SEED_OFFERED_JOB) continue;

    assert.ok(
      row.board_posted_at !== null,
      `job ${row.id} is neither his nor on the board`,
    );
    assert.equal(
      row.assigned_contractor_id,
      null,
      `board job ${row.id} is claimed and should have left the board`,
    );
    assert.ok(
      ["ready", "offered", "unfilled"].includes(row.status),
      `board job ${row.id} is in status ${row.status}, which is not open`,
    );
  }
});

test("an administrator sees every job", async () => {
  const rows = await asUser(ADMIN_ID, (c) =>
    c.query("select id from public.jobs").then((r) => r.rows),
  );
  assert.ok(rows.length >= 6, `admin should see all seeded jobs, saw ${rows.length}`);
});

test("a signed-out visitor sees no jobs at all", async () => {
  const rows = await asAnon((c) =>
    c.query("select id from public.jobs").then((r) => r.rows).catch(() => []),
  );
  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------------------
// Write protection
// ---------------------------------------------------------------------------

test("a contractor cannot update a job directly", async () => {
  const changed = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("update public.jobs set status = 'approved' where id = $1", [SEED_ASSIGNED_JOB])
      .then((r) => r.rowCount),
  );
  assert.equal(changed, 0, "no RLS policy may let a contractor write to jobs");

  const job = await getJob(SEED_ASSIGNED_JOB);
  assert.equal(job.status, "in_progress");
});

test("a contractor cannot repoint a job's pay", async () => {
  const changed = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query(
        "update public.jobs set contractor_labor_pay_cents = 999999 where id = $1",
        [SEED_ASSIGNED_JOB],
      )
      .then((r) => r.rowCount),
  );
  assert.equal(changed, 0);
});

test("a contractor cannot promote themselves to administrator", async () => {
  await assert.rejects(
    asUser(CONTRACTOR.marcus, (c) =>
      c.query("update public.profiles set role = 'admin' where id = $1", [CONTRACTOR.marcus]),
    ),
    /administrator/i,
    "self-promotion must be refused",
  );
});

test("a contractor cannot approve their own contractor account", async () => {
  await assert.rejects(
    asUser(CONTRACTOR.alicia, (c) =>
      c.query("update public.contractors set status = 'approved' where id = $1", [CONTRACTOR.alicia]),
    ),
    /approval status/i,
  );
});

test("a contractor can update their own availability and SMS preference", async () => {
  const changed = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query(
        "update public.contractors set is_available = false, sms_opt_in = false where id = $1",
        [CONTRACTOR.marcus],
      )
      .then((r) => r.rowCount),
  );
  assert.equal(changed, 1, "contractors own their own availability");
});

test("a contractor cannot edit another contractor's availability", async () => {
  const changed = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("update public.contractors set is_available = false where id = $1", [CONTRACTOR.dana])
      .then((r) => r.rowCount),
  );
  assert.equal(changed, 0);
});

// ---------------------------------------------------------------------------
// Confidential tables
// ---------------------------------------------------------------------------

test("a contractor cannot read another contractor's offers", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("select id from public.job_offers where contractor_id = $1", [CONTRACTOR.dana])
      .then((r) => r.rows),
  );
  assert.equal(rows.length, 0, "the competing roster must stay private");
});

test("a contractor cannot read the audit log", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.audit_log").then((r) => r.rows),
  );
  assert.equal(rows.length, 0);
});

test("a contractor cannot read outbound SMS records", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.sms_messages").then((r) => r.rows),
  );
  assert.equal(rows.length, 0);
});

test("a contractor cannot read outbound email records", async () => {
  // Sharper than the SMS case it mirrors: a sign-in email body carries a live
  // single-use link, so a readable table here would be a way to take over
  // another contractor's account rather than merely a way to snoop.
  await query(
    `insert into public.email_messages (to_email, subject, body, purpose, profile_id)
     values ('ray@example.com', 'Your sign-in link',
             'https://example.test/auth/link/secret-token', 'sign_in_link', $1)`,
    [CONTRACTOR.ray],
  );

  const other = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.email_messages").then((r) => r.rows),
  );
  assert.equal(other.length, 0, "another contractor's sign-in link is not readable");

  const own = await asUser(CONTRACTOR.ray, (c) =>
    c.query("select id from public.email_messages").then((r) => r.rows),
  );
  assert.equal(own.length, 0, "not even the recipient reads it back out of the table");

  const admin = await asUser(ADMIN_ID, (c) =>
    c.query("select id from public.email_messages").then((r) => r.rows),
  );
  assert.ok(admin.length > 0, "an administrator can see what was sent");
});

test("a losing contractor sees the job was taken, but not by whom", async () => {
  // The dashboard shows recently taken jobs to make the case for answering the
  // next text quickly. What it must never show is the winner, and that has to
  // hold in the database rather than in the page that happens not to render it.
  const { jobId } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus, CONTRACTOR.ray],
    title: "Taken-by-someone-else fixture",
  });

  // assigned_at is not optional here: a CHECK ties it to the assignee, so a
  // job cannot claim to have a contractor without recording when.
  await query(
    `update public.jobs
        set status = 'assigned', assigned_contractor_id = $1, assigned_at = now()
      where id = $2`,
    [CONTRACTOR.ray, jobId],
  );

  const seen = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query(
        "select id, title, assigned_contractor_id from public.jobs where id = $1",
        [jobId],
      )
      .then((r) => r.rows),
  );
  assert.equal(seen.length, 1, "the job he was offered is still readable");
  assert.equal(
    seen[0].assigned_contractor_id,
    CONTRACTOR.ray,
    "the winning id is on the row he can read",
  );

  // ...and is a dead end. One profile row is readable, and it is his own.
  const winner = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("select id, full_name, phone from public.profiles where id = $1", [
        CONTRACTOR.ray,
      ])
      .then((r) => r.rows),
  );
  assert.equal(winner.length, 0, "the winner's name and number are unreachable");

  const roster = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.contractors").then((r) => r.rows),
  );
  assert.deepEqual(
    roster.map((r) => r.id),
    [CONTRACTOR.marcus],
    "the roster is exactly himself",
  );
});

test("nobody but an administrator can read contractor applications", async () => {
  // An application holds a private mobile number and email address given by
  // someone who has no account and no relationship yet. The public form writes
  // with the service role precisely so this table needs no anon grant.
  // The harness database persists between runs, and the partial unique index
  // on pending applications is real, so start from a known state.
  await query(
    "delete from public.contractor_applications where phone = '+15165550188'",
  );
  await query(
    `insert into public.contractor_applications
       (full_name, phone, email, sms_opt_in, accepted_terms)
     values ('Applicant One', '+15165550188', 'applicant@example.com', true, true)`,
  );

  // anon holds no grant on public tables at all, so this is refused before RLS
  // is consulted -- stricter than the policy, and caught the same way the
  // jobs case above catches it.
  const anon = await asAnon((c) =>
    c
      .query("select id from public.contractor_applications")
      .then((r) => r.rows)
      .catch(() => []),
  );
  assert.equal(anon.length, 0, "an unauthenticated caller sees nothing");

  const contractor = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select phone from public.contractor_applications").then((r) => r.rows),
  );
  assert.equal(contractor.length, 0, "a contractor cannot browse applicants");

  const admin = await asUser(ADMIN_ID, (c) =>
    c.query("select id from public.contractor_applications").then((r) => r.rows),
  );
  assert.ok(admin.length > 0, "an administrator reviews them");
});

test("a second pending application for one number is refused", async () => {
  const insert = `insert into public.contractor_applications
      (full_name, phone, email, accepted_terms)
    values ('Twice Applied', '+15165550199', 'twice@example.com', true)`;

  await query(
    "delete from public.contractor_applications where phone = '+15165550199'",
  );
  await query(insert);
  await assert.rejects(
    () => query(insert),
    /duplicate key|unique/i,
    "one open application per number; a duplicate is two things to read",
  );

  // Declining releases the number, because circumstances change and people
  // reapply.
  await query(
    `update public.contractor_applications set status = 'declined'
     where phone = '+15165550199'`,
  );
  await query(insert);
});

test("a contractor cannot read the internal notes written about them", async () => {
  const rows = await asUser(CONTRACTOR.ray, (c) =>
    c.query("select body from public.contractor_notes").then((r) => r.rows),
  );
  assert.equal(rows.length, 0, "admin notes are invisible to their subject");
});

test("an administrator can read the audit log and internal notes", async () => {
  const audit = await asUser(ADMIN_ID, (c) =>
    c.query("select id from public.audit_log limit 5").then((r) => r.rows),
  );
  assert.ok(audit.length > 0, "seeding jobs should have produced audit entries");

  const notes = await asUser(ADMIN_ID, (c) =>
    c.query("select body from public.contractor_notes").then((r) => r.rows),
  );
  assert.ok(notes.length >= 2);
});

test("login tokens are invisible to every API role", async () => {
  await query(
    `insert into public.login_tokens (profile_id, token_hash, expires_at)
     values ($1, $2, now() + interval '1 hour')`,
    [CONTRACTOR.marcus, sha256(`probe-${Date.now()}`)],
  );

  const asContractor = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.login_tokens").then((r) => r.rows),
  );
  assert.equal(asContractor.length, 0);

  const asAdmin = await asUser(ADMIN_ID, (c) =>
    c.query("select id from public.login_tokens").then((r) => r.rows),
  );
  assert.equal(asAdmin.length, 0, "not even an admin reads raw login tokens");
});

// ---------------------------------------------------------------------------
// Eligibility gates on acceptance
// ---------------------------------------------------------------------------

test("an approved contractor without the required skill cannot accept", async () => {
  // Tom holds low-voltage but not the SSDC certification the job requires.
  const { tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.tom],
    requiredSkillIds: [SKILL.ssdc],
  });

  const [result] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.tom]),
  ]);
  assert.equal(result.result, "not_eligible");
  assert.match(result.message, /certification/i);
});

test("a contractor pending approval cannot accept", async () => {
  const { tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.alicia] });

  const [result] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.alicia]),
  ]);
  assert.equal(result.result, "not_eligible");
});

test("a suspended contractor cannot accept", async () => {
  const { tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.ray] });

  const [result] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.ray]),
  ]);
  assert.equal(result.result, "not_eligible");
});

test("a deactivated profile cannot accept", async () => {
  const { tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.dana] });
  await query("update public.profiles set is_active = false where id = $1", [CONTRACTOR.dana]);
  try {
    const [result] = await query("select * from public.accept_job_offer($1)", [
      sha256(tokens[CONTRACTOR.dana]),
    ]);
    assert.equal(result.result, "not_eligible");
  } finally {
    await query("update public.profiles set is_active = true where id = $1", [CONTRACTOR.dana]);
  }
});

test("an expired offer cannot be accepted", async () => {
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query(
    "update public.job_offers set expires_at = now() - interval '1 minute' where job_id = $1",
    [jobId],
  );

  const [result] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.marcus]),
  ]);
  assert.equal(result.result, "offer_expired");
});

test("a garbage or unknown token is rejected without leaking anything", async () => {
  const [bogus] = await query("select * from public.accept_job_offer($1)", ["not-a-hash"]);
  assert.equal(bogus.result, "offer_invalid");
  assert.equal(bogus.job_id, null);

  const [unknown] = await query("select * from public.accept_job_offer($1)", [sha256("nope")]);
  assert.equal(unknown.result, "offer_invalid");
  assert.equal(unknown.job_id, null);
});

test("a signed-in contractor cannot use someone else's offer link", async () => {
  const { tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus, CONTRACTOR.dana],
  });

  // Dana is signed in, but presents the token that was texted to Marcus.
  const [result] = await asUser(CONTRACTOR.dana, (c) =>
    c
      .query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])])
      .then((r) => r.rows),
  );
  assert.equal(result.result, "not_eligible");
  assert.match(result.message, /another contractor/i);
});

// ---------------------------------------------------------------------------
// Data integrity invariants
// ---------------------------------------------------------------------------

test("the audit log cannot be updated or deleted, even by the table owner", async () => {
  await assert.rejects(
    query("update public.audit_log set action = 'tampered' where id = (select min(id) from public.audit_log)"),
    /append-only/i,
  );
  await assert.rejects(
    query("delete from public.audit_log where id = (select min(id) from public.audit_log)"),
    /append-only/i,
  );
});

test("contractor labor pay is frozen once a job has been dispatched", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });

  await assert.rejects(
    query("update public.jobs set contractor_labor_pay_cents = 1 where id = $1", [jobId]),
    /labor pay is fixed/i,
    "repricing a dispatched job must be refused at the database level",
  );

  const job = await getJob(jobId);
  assert.equal(job.contractor_labor_pay_cents, 50000);
});

test("the mileage rate is frozen once a job has been dispatched", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    query("update public.jobs set mileage_rate = 2.50 where id = $1", [jobId]),
    /mileage rate is fixed/i,
  );
});

test("contractor labor pay is still editable while a job is a draft", async () => {
  const { jobId } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus],
    status: "draft",
  });
  await query(
    "update public.jobs set contractor_labor_pay_cents = 61000 where id = $1",
    [jobId],
  );

  const job = await getJob(jobId);
  assert.equal(job.contractor_labor_pay_cents, 61000);
  assert.equal(job.contractor_pay_cents, 61000, "the total follows the labor figure");
});

test("a job number cannot be rewritten", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    query("update public.jobs set job_number = 'MID-9999-0001' where id = $1", [jobId]),
    /immutable/i,
  );
});

test("work cannot be approved before it has been completed", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]),
    /only completed work/i,
  );
});

test("only approved work can be marked paid", async () => {
  await assert.rejects(
    query("select public.admin_mark_paid($1, $2, $3, $4)", [
      SEED_ASSIGNED_JOB,
      "CHK-1",
      "check",
      ADMIN_ID,
    ]),
    /only approved work/i,
  );
});

test("a contractor cannot act on a job that is not theirs", async () => {
  await assert.rejects(
    asUser(CONTRACTOR.priya, (c) =>
      c.query("select public.contractor_start_work($1)", [SEED_ASSIGNED_JOB]),
    ),
    /not assigned to you/i,
  );
});

test("completion is refused without a field ticket number", async () => {
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);

  await assert.rejects(
    query("select public.contractor_submit_completion($1, $2, $3, $4)", [
      jobId,
      "All done.",
      "   ",
      CONTRACTOR.marcus,
    ]),
    /field ticket/i,
    "the field ticket is the proof of work, so it cannot be blank",
  );
});

test("completion is refused without notes", async () => {
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);

  await assert.rejects(
    query("select public.contractor_submit_completion($1, $2, $3, $4)", [
      jobId,
      "",
      "FT-1001",
      CONTRACTOR.marcus,
    ]),
    /notes are required/i,
  );
});

test("an administrator cannot assign a job to an unqualified contractor", async () => {
  const { jobId } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus],
    requiredSkillIds: [SKILL.ssdc],
  });

  await assert.rejects(
    query("select public.admin_assign_contractor($1, $2, $3, $4)", [
      jobId,
      CONTRACTOR.tom,
      "covering a gap",
      ADMIN_ID,
    ]),
    /required skill/i,
  );
});

test("an administrator cannot assign a job to a suspended contractor", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    query("select public.admin_assign_contractor($1, $2, $3, $4)", [
      jobId,
      CONTRACTOR.ray,
      null,
      ADMIN_ID,
    ]),
    /not approved/i,
  );
});

test.after(async () => {
  await closePool();
});
