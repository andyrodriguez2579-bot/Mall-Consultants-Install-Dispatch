/**
 * End-to-end lifecycle tests.
 *
 * Walks a job through the whole business process the way the application does
 * -- create, dispatch, accept, work, submit, approve, pay -- and asserts the
 * guard rails hold at each step rather than only at the ends.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DATABASE_URL } from "../scripts/local-db.mjs";
import {
  ADMIN_ID,
  CONTRACTOR,
  SKILL,
  asUser,
  closePool,
  createContractors,
  createOfferedJob,
  getJob,
  query,
  sha256,
} from "./helpers/db.mjs";

async function addAfterPhoto(jobId, contractorId, name = "after-1.jpg") {
  await query(
    `insert into public.job_attachments (job_id, kind, file_path, file_name, uploaded_by)
     values ($1, 'after', $2, $3, $4)`,
    [jobId, `${jobId}/${crypto.randomUUID()}.jpg`, name, contractorId],
  );
}

test("a job runs the full lifecycle from dispatch to payment", async () => {
  const { jobId, tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus, CONTRACTOR.dana],
    payCents: 72500,
  });

  // 1. A contractor accepts.
  const [accept] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.marcus]),
  ]);
  assert.equal(accept.result, "accepted");
  assert.equal((await getJob(jobId)).status, "assigned");

  // 2. Arrival, then start.
  await query("select public.contractor_confirm_arrival($1, $2)", [jobId, CONTRACTOR.marcus]);
  let job = await getJob(jobId);
  assert.ok(job.arrival_confirmed_at, "arrival should be timestamped");
  assert.equal(job.status, "assigned", "confirming arrival alone does not start the job");

  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);
  job = await getJob(jobId);
  assert.equal(job.status, "in_progress");
  assert.ok(job.started_at);

  // 3. Evidence, then submission.
  await addAfterPhoto(jobId, CONTRACTOR.marcus);
  await query("select public.contractor_submit_completion($1, $2, $3)", [
    jobId,
    "Replaced the controller board and re-commissioned against the BMS.",
    CONTRACTOR.marcus,
  ]);
  job = await getJob(jobId);
  assert.equal(job.status, "completed");
  assert.ok(job.completed_at);

  // 4. Administrator approves.
  await query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]);
  job = await getJob(jobId);
  assert.equal(job.status, "approved");
  assert.equal(job.approved_by, ADMIN_ID);

  // 5. Payment is recorded against the fixed pay, not a re-entered figure.
  await query("select public.admin_mark_paid($1, $2, $3, $4)", [
    jobId,
    "ACH-TEST-001",
    "ACH",
    ADMIN_ID,
  ]);
  job = await getJob(jobId);
  assert.equal(job.status, "paid");
  assert.equal(job.contractor_pay_cents, 72500, "pay must equal what was accepted");
  assert.equal(job.payment_reference, "ACH-TEST-001");

  // The whole path is in the audit log.
  const events = await query(
    "select action from public.audit_log where entity_id = $1 order by id",
    [jobId],
  );
  const actions = events.map((e) => e.action);
  for (const expected of ["offer.accepted", "job.status_changed", "job.paid"]) {
    assert.ok(actions.includes(expected), `audit log should contain ${expected}`);
  }
});

test("the rework loop returns a job to the contractor and back", async () => {
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });

  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);
  await addAfterPhoto(jobId, CONTRACTOR.marcus);
  await query("select public.contractor_submit_completion($1, $2, $3)", [
    jobId,
    "Initial submission.",
    CONTRACTOR.marcus,
  ]);

  await query("select public.admin_request_rework($1, $2, $3)", [
    jobId,
    "The after photo of the north unit is out of focus. Please resubmit.",
    ADMIN_ID,
  ]);

  let job = await getJob(jobId);
  assert.equal(job.status, "needs_rework");
  assert.equal(job.rework_count, 1);
  assert.match(job.rework_notes, /out of focus/);

  // The contractor can resubmit straight from needs_rework.
  await query("select public.contractor_submit_completion($1, $2, $3)", [
    jobId,
    "Retook the north unit photo in better light.",
    CONTRACTOR.marcus,
  ]);
  job = await getJob(jobId);
  assert.equal(job.status, "completed");

  await query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]);
  assert.equal((await getJob(jobId)).status, "approved");
});

test("in-app acceptance is subject to the same single-winner guarantee", async () => {
  const contractorIds = await createContractors(10, [SKILL.ssdc]);
  const { jobId } = await createOfferedJob({ contractorIds });

  const offers = await query(
    "select id, contractor_id from public.job_offers where job_id = $1",
    [jobId],
  );

  // Race accept_job_offer_by_id, each on its own connection and each carrying
  // its own contractor's JWT claim -- the signed-in path, not the SMS path.
  const clients = offers.map(() => new pg.Client({ connectionString: DATABASE_URL }));
  await Promise.all(clients.map((c) => c.connect()));

  try {
    // Session-level settings, deliberately NOT inside an explicit transaction.
    // Wrapping each racer in a transaction that only commits after Promise.all
    // would deadlock: the winner holds the job's row lock while the losers wait
    // on a commit that cannot happen until they return. Autocommit reproduces
    // what a real Supabase RPC call does anyway -- one statement, one
    // transaction.
    await Promise.all(
      clients.map(async (client, i) => {
        await client.query("set role authenticated");
        await client.query("select set_config('request.jwt.claim.sub', $1, false)", [
          offers[i].contractor_id,
        ]);
      }),
    );

    const results = await Promise.all(
      clients.map((client, i) =>
        client
          .query("select * from public.accept_job_offer_by_id($1)", [offers[i].id])
          .then((r) => r.rows[0])
          .catch((err) => ({ result: "error", message: err.message })),
      ),
    );

    const counts = results.reduce((acc, r) => {
      acc[r.result] = (acc[r.result] ?? 0) + 1;
      return acc;
    }, {});

    assert.equal(counts.accepted, 1, `expected one winner, got ${JSON.stringify(counts)}`);
    assert.equal(counts.already_filled, 9);
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }

  assert.equal((await getJob(jobId)).status, "assigned");
});

test("the expiry sweep marks an unanswered job unfilled", async () => {
  const { jobId } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus, CONTRACTOR.dana],
  });

  // Wind the window back past now.
  await query(
    "update public.jobs set offer_expires_at = now() - interval '1 minute' where id = $1",
    [jobId],
  );
  await query(
    "update public.job_offers set expires_at = now() - interval '1 minute' where job_id = $1",
    [jobId],
  );

  await query("select public.expire_stale_offers()");

  const job = await getJob(jobId);
  assert.equal(job.status, "unfilled");
  assert.ok(job.unfilled_at);

  const offers = await query(
    "select status from public.job_offers where job_id = $1",
    [jobId],
  );
  assert.ok(
    offers.every((o) => o.status === "expired"),
    "every unanswered offer should be expired",
  );
});

test("an expired job can be re-offered in a new round", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query(
    "update public.jobs set offer_expires_at = now() - interval '1 minute' where id = $1",
    [jobId],
  );
  await query(
    "update public.job_offers set expires_at = now() - interval '1 minute' where job_id = $1",
    [jobId],
  );
  await query("select public.expire_stale_offers()");

  // Round two, to a different contractor.
  const rawToken = `retry-${crypto.randomUUID()}`;
  await query(
    `update public.jobs
        set status = 'offered', offer_round = offer_round + 1,
            offer_expires_at = now() + interval '4 hours', unfilled_at = null
      where id = $1`,
    [jobId],
  );
  await query(
    `insert into public.job_offers (job_id, contractor_id, round, status, token_hash, expires_at, sent_at)
     values ($1, $2, 2, 'delivered', $3, now() + interval '4 hours', now())`,
    [jobId, CONTRACTOR.priya, sha256(rawToken)],
  );

  const [result] = await query("select * from public.accept_job_offer($1)", [sha256(rawToken)]);
  assert.equal(result.result, "accepted");

  const job = await getJob(jobId);
  assert.equal(job.assigned_contractor_id, CONTRACTOR.priya);
  assert.equal(job.offer_round, 2);
});

test("a cancelled job closes out its live offers and cannot be accepted", async () => {
  const { jobId, tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus, CONTRACTOR.dana],
  });

  await query("select public.admin_cancel_job($1, $2, $3)", [
    jobId,
    "Customer postponed the install.",
    ADMIN_ID,
  ]);

  assert.equal((await getJob(jobId)).status, "cancelled");

  const [result] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.marcus]),
  ]);
  assert.equal(result.result, "already_filled");
});

test("an administrator can reassign an in-progress job to another contractor", async () => {
  const { jobId, tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus],
    requiredSkillIds: [SKILL.ssdc],
  });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);

  await query("select public.admin_assign_contractor($1, $2, $3, $4)", [
    jobId,
    CONTRACTOR.priya,
    "Marcus was pulled onto an emergency call",
    ADMIN_ID,
  ]);

  const job = await getJob(jobId);
  assert.equal(job.assigned_contractor_id, CONTRACTOR.priya);
  assert.equal(job.status, "assigned");

  // And the previous assignee loses access to the work actions.
  await assert.rejects(
    asUser(CONTRACTOR.marcus, (c) =>
      c.query("select public.contractor_start_work($1)", [jobId]),
    ),
    /not assigned to you/i,
  );
});

test("pay stays fixed across the entire lifecycle", async () => {
  const { jobId, tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus],
    payCents: 63400,
  });

  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);

  // Every stage refuses a reprice, not just the first.
  for (const step of [
    null,
    "select public.contractor_start_work($1, $2)",
  ]) {
    if (step) await query(step, [jobId, CONTRACTOR.marcus]);
    await assert.rejects(
      query("update public.jobs set contractor_pay_cents = 1000 where id = $1", [jobId]),
      /pay is fixed/i,
    );
  }

  await addAfterPhoto(jobId, CONTRACTOR.marcus);
  await query("select public.contractor_submit_completion($1, $2, $3)", [
    jobId,
    "Done.",
    CONTRACTOR.marcus,
  ]);
  await query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]);
  await query("select public.admin_mark_paid($1, $2, $3, $4)", [jobId, "REF-1", "ACH", ADMIN_ID]);

  assert.equal((await getJob(jobId)).contractor_pay_cents, 63400);
});

test("a contractor cannot submit completion for someone else's job", async () => {
  const { jobId, tokens } = await createOfferedJob({
    contractorIds: [CONTRACTOR.marcus, CONTRACTOR.dana],
  });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);
  await addAfterPhoto(jobId, CONTRACTOR.marcus);

  await assert.rejects(
    asUser(CONTRACTOR.dana, (c) =>
      c.query("select public.contractor_submit_completion($1, $2)", [jobId, "I did this one."]),
    ),
    /not assigned to you/i,
  );
});

test.after(async () => {
  await closePool();
});
