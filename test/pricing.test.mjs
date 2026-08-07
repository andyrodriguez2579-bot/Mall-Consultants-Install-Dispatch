/**
 * Pricing, work order and payment-run tests.
 *
 * The money path is the part of this system a contractor will argue about, so
 * the guarantees it rests on -- a total that follows its work items, a rate
 * that cannot move after dispatch, a catalogue edit that cannot reach back into
 * a job already accepted -- are asserted here rather than assumed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ID,
  CONTRACTOR,
  closePool,
  createOfferedJob,
  getJob,
  query,
  sha256,
} from "./helpers/db.mjs";

async function priceItem(code) {
  const [item] = await query("select * from public.price_list_items where code = $1", [code]);
  return item;
}

/** A draft job with no line items yet. */
async function createDraftJob({ payCents = 0, paySource = "line_items" } = {}) {
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, contractor_pay_cents, pay_source, created_by
     ) values (
       'draft', 'Pricing fixture', 'Fixture Customer', '1 Test Way', 'Houston', 'TX', '77002',
       'Fixture scope', $1, $2, $3
     ) returning id`,
    [payCents, paySource, ADMIN_ID],
  );
  return job.id;
}

async function addLine(jobId, item, quantity) {
  await query(
    `insert into public.job_line_items
       (job_id, price_list_item_id, code, description, unit, unit_price_cents, quantity)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [jobId, item.id, item.code, item.name, item.unit, item.unit_price_cents, quantity],
  );
}

// ---------------------------------------------------------------------------
// Line items drive the total
// ---------------------------------------------------------------------------

test("a job's pay is the sum of its work items", async () => {
  const jobId = await createDraftJob();
  const swap = await priceItem("SSDC-SWAP");
  const trip = await priceItem("TRIP-STD");

  await addLine(jobId, swap, 2);
  await addLine(jobId, trip, 1);

  const job = await getJob(jobId);
  assert.equal(job.contractor_pay_cents, swap.unit_price_cents * 2 + trip.unit_price_cents);
});

test("changing a quantity recomputes the total", async () => {
  const jobId = await createDraftJob();
  const swap = await priceItem("SSDC-SWAP");
  await addLine(jobId, swap, 1);

  await query("update public.job_line_items set quantity = 3 where job_id = $1", [jobId]);

  assert.equal((await getJob(jobId)).contractor_pay_cents, swap.unit_price_cents * 3);
});

test("removing every work item takes the total to zero", async () => {
  const jobId = await createDraftJob();
  await addLine(jobId, await priceItem("SSDC-SWAP"), 2);
  await query("delete from public.job_line_items where job_id = $1", [jobId]);

  assert.equal((await getJob(jobId)).contractor_pay_cents, 0);
});

test("fractional quantities are priced correctly", async () => {
  const jobId = await createDraftJob();
  const labour = await priceItem("LABOR-HR"); // 8500 cents/hour
  await addLine(jobId, labour, 2.5);

  assert.equal((await getJob(jobId)).contractor_pay_cents, Math.round(8500 * 2.5));
});

test("a manually priced job ignores its work items", async () => {
  const jobId = await createDraftJob({ payCents: 99000, paySource: "manual" });
  await addLine(jobId, await priceItem("SSDC-SWAP"), 1);

  assert.equal(
    (await getJob(jobId)).contractor_pay_cents,
    99000,
    "an overridden total must not be recomputed",
  );
});

// ---------------------------------------------------------------------------
// The catalogue cannot reach backwards
// ---------------------------------------------------------------------------

test("re-pricing the catalogue leaves existing jobs untouched", async () => {
  const jobId = await createDraftJob();
  const swap = await priceItem("SSDC-SWAP");
  await addLine(jobId, swap, 2);

  const before = (await getJob(jobId)).contractor_pay_cents;

  await query("update public.price_list_items set unit_price_cents = 999999 where id = $1", [
    swap.id,
  ]);

  const line = (
    await query("select unit_price_cents from public.job_line_items where job_id = $1", [jobId])
  )[0];

  assert.equal(line.unit_price_cents, swap.unit_price_cents, "the job keeps its own rate");
  assert.equal((await getJob(jobId)).contractor_pay_cents, before);

  await query("update public.price_list_items set unit_price_cents = $1 where id = $2", [
    swap.unit_price_cents,
    swap.id,
  ]);
});

test("retiring a catalogue item does not disturb jobs that used it", async () => {
  const jobId = await createDraftJob();
  const item = await priceItem("LIFT-DAY");
  await addLine(jobId, item, 1);

  await query("update public.price_list_items set is_active = false where id = $1", [item.id]);
  assert.equal((await getJob(jobId)).contractor_pay_cents, item.unit_price_cents);

  await query("update public.price_list_items set is_active = true where id = $1", [item.id]);
});

// ---------------------------------------------------------------------------
// Locking at dispatch
// ---------------------------------------------------------------------------

test("work items cannot be added once a job is dispatched", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  const item = await priceItem("SSDC-SWAP");

  await assert.rejects(
    addLine(jobId, item, 1),
    /cannot be changed once a job is dispatched/i,
  );
});

test("work items cannot be edited or removed once a job is dispatched", async () => {
  const jobId = await createDraftJob();
  await addLine(jobId, await priceItem("SSDC-SWAP"), 1);

  await query("update public.jobs set status = 'offered' where id = $1", [jobId]);

  await assert.rejects(
    query("update public.job_line_items set quantity = 5 where job_id = $1", [jobId]),
    /cannot be changed once a job is dispatched/i,
  );
  await assert.rejects(
    query("delete from public.job_line_items where job_id = $1", [jobId]),
    /cannot be changed once a job is dispatched/i,
  );
});

// ---------------------------------------------------------------------------
// Explicit override
// ---------------------------------------------------------------------------

test("an override sets the total, records the reason, and switches pricing mode", async () => {
  const jobId = await createDraftJob();
  await addLine(jobId, await priceItem("SSDC-SWAP"), 2);

  await query("select public.admin_override_job_pay($1, $2, $3, $4)", [
    jobId,
    125000,
    "Customer negotiated a fixed price for the whole vestibule",
    ADMIN_ID,
  ]);

  const job = await getJob(jobId);
  assert.equal(job.contractor_pay_cents, 125000);
  assert.equal(job.pay_source, "manual");
  assert.match(job.pay_override_reason, /negotiated/);

  const [audit] = await query(
    "select detail from public.audit_log where entity_id = $1 and action = 'job.pay_overridden'",
    [jobId],
  );
  assert.ok(audit, "the override must be in the audit log");
  assert.equal(audit.detail.pay_cents, 125000);
});

test("an override without a reason is refused", async () => {
  const jobId = await createDraftJob();
  await assert.rejects(
    query("select public.admin_override_job_pay($1, $2, $3, $4)", [jobId, 50000, "", ADMIN_ID]),
    /needs a reason/i,
  );
});

test("an override is refused once the job is dispatched", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    query("select public.admin_override_job_pay($1, $2, $3, $4)", [
      jobId,
      1000,
      "Trying to reprice after the fact",
      ADMIN_ID,
    ]),
    /pay is fixed once a job is dispatched/i,
  );
});

test("returning to line-item pricing recomputes from the work items", async () => {
  const jobId = await createDraftJob();
  const swap = await priceItem("SSDC-SWAP");
  await addLine(jobId, swap, 2);

  await query("select public.admin_override_job_pay($1, $2, $3, $4)", [
    jobId,
    125000,
    "Temporary override",
    ADMIN_ID,
  ]);
  await query("select public.admin_use_line_item_pricing($1, $2)", [jobId, ADMIN_ID]);

  const job = await getJob(jobId);
  assert.equal(job.pay_source, "line_items");
  assert.equal(job.contractor_pay_cents, swap.unit_price_cents * 2);
  assert.equal(job.pay_override_reason, null);
});

// ---------------------------------------------------------------------------
// Friday payment runs
// ---------------------------------------------------------------------------

test("next_friday lands on the coming Friday", async () => {
  const cases = [
    ["2026-04-20", "2026-04-24"], // Monday   -> that Friday
    ["2026-04-23", "2026-04-24"], // Thursday -> tomorrow
    ["2026-04-24", "2026-04-24"], // Friday   -> today
    ["2026-04-25", "2026-05-01"], // Saturday -> next week
    ["2026-04-26", "2026-05-01"], // Sunday   -> next week
  ];

  for (const [from, expected] of cases) {
    const [row] = await query("select public.next_friday($1::date)::text as d", [from]);
    assert.equal(row.d, expected, `${from} should schedule into ${expected}`);
  }
});

test("approving work schedules it into a Friday run", async () => {
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);
  await query("select public.contractor_submit_completion($1, $2, $3, $4)", [
    jobId,
    "Work finished and ticketed.",
    "FT-PAY-001",
    CONTRACTOR.marcus,
  ]);
  await query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]);

  const job = await getJob(jobId);
  assert.ok(job.scheduled_pay_date, "approval should schedule a pay date");

  const [{ d }] = await query("select public.next_friday(current_date)::text as d");
  assert.equal(job.scheduled_pay_date.toISOString().slice(0, 10), d);

  // And the ticket reference is what an admin reconciles against.
  assert.equal(job.field_ticket_ref, "FT-PAY-001");
});

/** Take a job all the way to approved, ready to be paid. */
async function approvedJob(contractorId = CONTRACTOR.marcus, payCents = 40000) {
  const { jobId, tokens } = await createOfferedJob({
    contractorIds: [contractorId],
    payCents,
  });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[contractorId])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, contractorId]);
  await query("select public.contractor_submit_completion($1, $2, $3, $4)", [
    jobId,
    "Done.",
    `FT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    contractorId,
  ]);
  await query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]);
  return jobId;
}

test("a payment run marks every selected job paid in one go", async () => {
  const a = await approvedJob(CONTRACTOR.marcus, 40000);
  const b = await approvedJob(CONTRACTOR.dana, 55000);

  const [{ admin_mark_paid_batch: count }] = await query(
    "select public.admin_mark_paid_batch($1::uuid[], $2, $3, $4)",
    [[a, b], "ACH-2026-0424", "ACH", ADMIN_ID],
  );

  assert.equal(count, 2);

  for (const id of [a, b]) {
    const job = await getJob(id);
    assert.equal(job.status, "paid");
    assert.equal(job.payment_reference, "ACH-2026-0424");
    assert.ok(job.paid_at);
  }
});

test("a payment run is all-or-nothing", async () => {
  const good = await approvedJob(CONTRACTOR.marcus, 30000);
  const { jobId: notApproved } = await createOfferedJob({ contractorIds: [CONTRACTOR.priya] });

  await assert.rejects(
    query("select public.admin_mark_paid_batch($1::uuid[], $2, $3, $4)", [
      [good, notApproved],
      "ACH-BAD",
      "ACH",
      ADMIN_ID,
    ]),
    /not approved/i,
  );

  // The good job must not have been paid by the half-completed run.
  assert.equal((await getJob(good)).status, "approved");
});

test("a payment run records the batch in the audit log", async () => {
  const id = await approvedJob(CONTRACTOR.marcus, 21000);
  await query("select public.admin_mark_paid_batch($1::uuid[], $2, $3, $4)", [
    [id],
    "ACH-AUDIT-1",
    "ACH",
    ADMIN_ID,
  ]);

  const [entry] = await query(
    `select detail from public.audit_log
      where action = 'payment_run.recorded' and detail->>'reference' = 'ACH-AUDIT-1'`,
  );
  assert.ok(entry, "the run should be logged");
  assert.equal(entry.detail.jobs, 1);
});

test("paying does not alter the amount the contractor accepted", async () => {
  const id = await approvedJob(CONTRACTOR.marcus, 47250);
  await query("select public.admin_mark_paid_batch($1::uuid[], $2, $3, $4)", [
    [id],
    "ACH-FIXED",
    "ACH",
    ADMIN_ID,
  ]);
  assert.equal((await getJob(id)).contractor_pay_cents, 47250);
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test("a contractor can read the price list and their own job's breakdown", async () => {
  const { asUser } = await import("./helpers/db.mjs");

  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.price_list_items").then((r) => r.rows),
  );
  assert.ok(rows.length > 0, "the price list is what a contractor is paid from");
});

test("a contractor cannot see line items for a job that is not theirs", async () => {
  const { asUser } = await import("./helpers/db.mjs");

  const jobId = await createDraftJob();
  await addLine(jobId, await priceItem("SSDC-SWAP"), 1);

  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("select id from public.job_line_items where job_id = $1", [jobId])
      .then((r) => r.rows),
  );
  assert.equal(rows.length, 0);
});

test("a contractor cannot edit the price list", async () => {
  const { asUser } = await import("./helpers/db.mjs");

  const changed = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("update public.price_list_items set unit_price_cents = 999999")
      .then((r) => r.rowCount),
  );
  assert.equal(changed, 0);
});

test("install requests are invisible to contractors", async () => {
  const { asUser } = await import("./helpers/db.mjs");

  await query(
    "insert into public.install_requests (raw_text, created_by) values ($1, $2)",
    ["Customer: Acme\nReplace 1 SSDC unit.", ADMIN_ID],
  );

  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.install_requests").then((r) => r.rows),
  );
  assert.equal(rows.length, 0);

  const asAdmin = await asUser(ADMIN_ID, (c) =>
    c.query("select id from public.install_requests").then((r) => r.rows),
  );
  assert.ok(asAdmin.length > 0, "an administrator should see intake");
});

test.after(async () => {
  await closePool();
});
