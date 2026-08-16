/**
 * Pricing tests: the 45/55 labor split, separate mileage, separate expenses.
 *
 * This is the part of the system that decides what people get paid, so the
 * rules are asserted rather than assumed -- including the property that matters
 * most in practice: the two shares always add back up to the revenue, on every
 * amount, with no cent lost to rounding.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ID,
  CONTRACTOR,
  asUser,
  closePool,
  createOfferedJob,
  getJob,
  query,
  sha256,
} from "./helpers/db.mjs";

const money = (cents) => (cents / 100).toFixed(2);

async function createPricedJob({
  customerPriceCents = 12000,
  taskCount = 1,
  additionalCents = 0,
  bps = null,
  status = "draft",
} = {}) {
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, created_by
     ) values ($1, 'Pricing fixture', 'Fixture Customer', '1 Test Way',
               'Houston', 'TX', '77002', 'Fixture scope', $2)
     returning id`,
    [status, ADMIN_ID],
  );

  await query(
    `insert into public.job_pricing
       (job_id, additional_labor_cents,
        additional_labor_approved_at, contractor_percentage_bps)
     values ($1, $2, case when $2 > 0 then now() else null end,
             coalesce($3, public.default_contractor_bps()))`,
    [job.id, additionalCents, bps],
  );

  // The customer price now lives on a service line rather than on job_pricing.
  if (customerPriceCents > 0) {
    await query(
      `insert into public.job_service_lines
         (job_id, description, unit_price_cents, quantity)
       values ($1, 'Fixture service', $2, $3)`,
      [job.id, customerPriceCents, taskCount],
    );
  }

  return job.id;
}

const pricingOf = async (jobId) =>
  (await query("select * from public.job_pricing where job_id = $1", [jobId]))[0];

// ---------------------------------------------------------------------------
// The worked example from the specification
// ---------------------------------------------------------------------------

test("the A-Program worked example reproduces exactly", async () => {
  // Customer labor price $120.00, 1 task, no additional labor,
  // 50 miles driven, 30 excluded, $0.725/mile.
  const jobId = await createPricedJob({ customerPriceCents: 12000, taskCount: 1 });

  await query(
    `update public.jobs
        set contractor_miles = 50, excluded_miles = 30, mileage_rate = 0.7250
      where id = $1`,
    [jobId],
  );

  const pricing = await pricingOf(jobId);
  const job = await getJob(jobId);

  assert.equal(money(pricing.base_labor_total_cents), "120.00", "Base Labor Total");
  assert.equal(money(pricing.total_labor_revenue_cents), "120.00", "Total Labor Revenue");
  assert.equal(money(pricing.contractor_labor_pay_cents), "54.00", "Contractor Labor Pay");
  assert.equal(money(pricing.mall_share_cents), "66.00", "Mall Consultants Share");
  assert.equal(Number(job.payable_miles), 20, "Payable Miles");
  assert.equal(money(job.mileage_payment_cents), "14.50", "Mileage Payment");
  assert.equal(money(job.contractor_pay_cents), "68.50", "Total Contractor Payment");

  const [fin] = await query(
    "select * from public.job_financials where job_id = $1",
    [jobId],
  );
  assert.equal(money(fin.total_customer_charge_cents), "134.50", "Total Customer Charge");
});

test("the SSDC-A-PROGRAM catalogue record is priced as specified", async () => {
  const [item] = await query(
    "select * from public.price_list_items where code = 'SSDC-A-PROGRAM'",
  );

  assert.ok(item, "the reference record must exist");
  assert.equal(item.name, "SSDC A-Program Installation");
  assert.equal(item.category, "SSDC Installation");
  assert.equal(money(item.customer_labor_price_cents), "120.00");
  assert.equal(item.contractor_percentage_bps, 4500);
  assert.equal(money(item.contractor_labor_pay_cents), "54.00");
  assert.equal(money(item.mall_share_cents), "66.00");
  assert.equal(item.is_active, true);
});

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

test("quantity multiplies the customer price before the split", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 12000, taskCount: 3 });
  const p = await pricingOf(jobId);

  assert.equal(money(p.base_labor_total_cents), "360.00");
  assert.equal(money(p.contractor_labor_pay_cents), "162.00"); // 45% of 360
  assert.equal(money(p.mall_share_cents), "198.00");
});

test("approved additional labor is added before the split", async () => {
  const jobId = await createPricedJob({
    customerPriceCents: 12000,
    taskCount: 1,
    additionalCents: 4060, // one hour at the workbook's $40.60 allowance
  });
  const p = await pricingOf(jobId);

  assert.equal(money(p.total_labor_revenue_cents), "160.60");
  assert.equal(money(p.contractor_labor_pay_cents), "72.27"); // 45% of 160.60
  assert.equal(money(p.mall_share_cents), "88.33");
  assert.equal(
    p.contractor_labor_pay_cents + p.mall_share_cents,
    p.total_labor_revenue_cents,
  );
});

test("the two shares always add back up to the revenue, on any amount", async () => {
  // The reason the Mall Consultants share is subtraction rather than its own
  // 55% multiplication: on odd amounts the two percentages would each round up
  // and lose a cent between them.
  const awkward = [1, 3, 7, 33, 99, 101, 4999, 12345, 67891, 100003, 999999];

  for (const cents of awkward) {
    const jobId = await createPricedJob({ customerPriceCents: cents, taskCount: 1 });
    const p = await pricingOf(jobId);

    assert.equal(
      p.contractor_labor_pay_cents + p.mall_share_cents,
      p.total_labor_revenue_cents,
      `shares must reconcile at ${cents} cents`,
    );
    assert.ok(p.contractor_labor_pay_cents >= 0 && p.mall_share_cents >= 0);
  }
});

test("the contractor percentage is configurable and applied", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 20000, bps: 5000 });
  const p = await pricingOf(jobId);

  assert.equal(money(p.contractor_labor_pay_cents), "100.00");
  assert.equal(money(p.mall_share_cents), "100.00");
});

test("changing the setting does not reprice a job already quoted", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 12000 });
  const before = await pricingOf(jobId);
  assert.equal(money(before.contractor_labor_pay_cents), "54.00");

  await query(
    "update public.app_settings set value = 6000 where key = 'contractor_percentage_bps'",
  );
  try {
    const after = await pricingOf(jobId);
    assert.equal(
      money(after.contractor_labor_pay_cents),
      "54.00",
      "the job keeps the percentage it was priced at",
    );

    // A new job picks the new rate up.
    const freshId = await createPricedJob({ customerPriceCents: 12000 });
    assert.equal(money((await pricingOf(freshId)).contractor_labor_pay_cents), "72.00");
  } finally {
    await query(
      "update public.app_settings set value = 4500 where key = 'contractor_percentage_bps'",
    );
  }
});

// ---------------------------------------------------------------------------
// Mileage
// ---------------------------------------------------------------------------

test("the commuter deduction is applied and never goes negative", async () => {
  const cases = [
    [50, 30, 20],
    [30, 30, 0],
    [12, 30, 0], // a short trip inside the commuter radius pays nothing
    [0, 30, 0],
    [130.5, 30, 100.5],
  ];

  for (const [miles, excluded, expected] of cases) {
    const [row] = await query("select public.calc_payable_miles($1, $2) as m", [
      miles,
      excluded,
    ]);
    assert.equal(Number(row.m), expected, `${miles} - ${excluded}`);
    assert.ok(Number(row.m) >= 0, "payable miles can never be negative");
  }
});

test("mileage is paid at the rate and is not subject to the split", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 12000 });
  await query(
    "update public.jobs set contractor_miles = 130, excluded_miles = 30, mileage_rate = 0.70 where id = $1",
    [jobId],
  );

  const job = await getJob(jobId);
  assert.equal(Number(job.payable_miles), 100);
  assert.equal(money(job.mileage_payment_cents), "70.00", "100 miles at $0.70");

  // The contractor receives the mileage whole: labor 54.00 + mileage 70.00.
  assert.equal(money(job.contractor_pay_cents), "124.00");

  const [fin] = await query("select * from public.job_financials where job_id = $1", [jobId]);
  assert.equal(
    money(fin.mall_share_cents),
    "66.00",
    "the Mall Consultants share is unchanged by mileage",
  );
});

test("recording mileage computes the payment and logs it", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 12000 });
  await query("select public.record_job_mileage($1, $2, $3, $4, $5, $6)", [
    jobId,
    88,
    30,
    120400,
    120488,
    ADMIN_ID,
  ]);

  const job = await getJob(jobId);
  assert.equal(Number(job.payable_miles), 58);
  assert.equal(Number(job.start_odometer), 120400);
  assert.equal(Number(job.end_odometer), 120488);

  const [entry] = await query(
    "select detail from public.audit_log where entity_id = $1 and action = 'job.mileage_recorded'",
    [jobId],
  );
  assert.ok(entry, "mileage must be auditable");
  assert.equal(Number(entry.detail.payable), 58);
});

test("negative miles are refused", async () => {
  const jobId = await createPricedJob();
  await assert.rejects(
    query("select public.record_job_mileage($1, $2, $3, null, null, $4)", [
      jobId,
      -10,
      0,
      ADMIN_ID,
    ]),
    /cannot be negative/i,
  );
});

test("a contractor cannot record mileage on a job that is not theirs", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    asUser(CONTRACTOR.dana, (c) =>
      c.query("select public.record_job_mileage($1, $2)", [jobId, 40]),
    ),
    /not assigned to you/i,
  );
});

test("estimated road miles are derived from the contractor's base", async () => {
  // Houston 77002 to Friendswood 77546, roughly 22 straight-line miles.
  const [row] = await query(
    "select public.estimate_road_miles(29.7589, -95.3677, 29.5294, -95.1860, true) as m",
  );
  const miles = Number(row.m);
  assert.ok(miles > 40 && miles < 80, `round trip estimate looked wrong: ${miles}`);

  const [same] = await query(
    "select public.estimate_road_miles(29.7589, -95.3677, 29.7589, -95.3677, true) as m",
  );
  assert.equal(Number(same.m), 0);

  const [missing] = await query(
    "select public.estimate_road_miles(null, null, 29.5, -95.1, true) as m",
  );
  assert.equal(missing.m, null, "no coordinates means no estimate, not a wrong one");
});

// ---------------------------------------------------------------------------
// Reimbursable expenses
// ---------------------------------------------------------------------------

test("expenses pass through whole and are not split", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 12000 });

  await query("select public.admin_approve_expenses($1, $2, $3, $4, $5, $6)", [
    jobId,
    4235, // materials
    1800, // tolls and parking
    13900, // hotel
    500, // other
    ADMIN_ID,
  ]);

  const job = await getJob(jobId);
  assert.equal(money(job.total_expenses_cents), "204.35");
  assert.equal(money(job.contractor_pay_cents), "258.35", "54.00 labor + 204.35 expenses");

  const [fin] = await query("select * from public.job_financials where job_id = $1", [jobId]);
  assert.equal(money(fin.mall_share_cents), "66.00", "expenses do not change the share");
  assert.equal(money(fin.total_customer_charge_cents), "324.35", "120.00 + 204.35");
});

test("expense approval is stamped with who approved it", async () => {
  const jobId = await createPricedJob();
  await query("select public.admin_approve_expenses($1, $2, 0, 0, 0, $3)", [
    jobId,
    2500,
    ADMIN_ID,
  ]);

  const job = await getJob(jobId);
  assert.equal(job.expenses_approved_by, ADMIN_ID);
  assert.ok(job.expenses_approved_at);

  const [entry] = await query(
    "select detail from public.audit_log where entity_id = $1 and action = 'job.expenses_approved'",
    [jobId],
  );
  assert.ok(entry);
});

test("negative expenses are refused", async () => {
  const jobId = await createPricedJob();
  await assert.rejects(
    query("select public.admin_approve_expenses($1, -100, 0, 0, 0, $2)", [jobId, ADMIN_ID]),
    /cannot be negative/i,
  );
});

test("unapproved additional labor cannot be stored", async () => {
  const [job] = await query(
    `insert into public.jobs (status, title, customer_name, address_line1, city,
                              state_code, postal_code, scope, created_by)
     values ('draft','x','x','1 Test Way','Houston','TX','77002','x',$1) returning id`,
    [ADMIN_ID],
  );

  await assert.rejects(
    query(
      `insert into public.job_pricing (job_id, additional_labor_cents)
       values ($1, 5000)`,
      [job.id],
    ),
    /job_pricing_additional_labor_approval/i,
    "additional labor requires an approval timestamp",
  );
});

// ---------------------------------------------------------------------------
// Freezing at dispatch
// ---------------------------------------------------------------------------

test("customer pricing is frozen once a job is dispatched", async () => {
  // Price it while it is still a draft, then dispatch it.
  const jobId = await createPricedJob({ customerPriceCents: 12000 });
  await query("update public.jobs set status = 'offered' where id = $1", [jobId]);

  await assert.rejects(
    query(
      "update public.job_pricing set additional_labor_cents = 99900 where job_id = $1",
      [jobId],
    ),
    /pricing is fixed once a job is dispatched/i,
  );

  // The lines are part of the same agreement, so they freeze with it -- adding,
  // repricing or removing a service after dispatch all have to be refused.
  await assert.rejects(
    query(
      `insert into public.job_service_lines (job_id, description, unit_price_cents, quantity)
       values ($1, 'Snuck in later', 50000, 1)`,
      [jobId],
    ),
    /pricing is fixed once a job is dispatched/i,
  );

  await assert.rejects(
    query("update public.job_service_lines set unit_price_cents = 99900 where job_id = $1", [jobId]),
    /pricing is fixed once a job is dispatched/i,
  );

  await assert.rejects(
    query("delete from public.job_service_lines where job_id = $1", [jobId]),
    /pricing is fixed once a job is dispatched/i,
  );

  assert.equal(
    (await pricingOf(jobId)).lines_subtotal_cents,
    12000,
    "the quoted price must survive every attempt",
  );
});

test("pricing cannot be attached to a job after it has been dispatched", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await assert.rejects(
    query(
      `insert into public.job_pricing (job_id, additional_labor_cents)
       values ($1, 0)`,
      [jobId],
    ),
    /pricing is fixed once a job is dispatched/i,
  );
});

test("expenses can still be approved after dispatch, unlike labor", async () => {
  // Reimbursables are only knowable after the trip, and sit outside the labor
  // agreement by definition, so they must remain addable.
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);

  await query("select public.admin_approve_expenses($1, 3000, 1200, 0, 0, $2)", [
    jobId,
    ADMIN_ID,
  ]);

  const job = await getJob(jobId);
  assert.equal(money(job.total_expenses_cents), "42.00");
  assert.equal(
    money(job.contractor_pay_cents),
    "542.00",
    "the total grows by the reimbursement, while labor stays at 500.00",
  );
  assert.equal(money(job.contractor_labor_pay_cents), "500.00");
});

test("expenses cannot be revised after a job has been paid", async () => {
  const { jobId, tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });
  await query("select * from public.accept_job_offer($1)", [sha256(tokens[CONTRACTOR.marcus])]);
  await query("select public.contractor_start_work($1, $2)", [jobId, CONTRACTOR.marcus]);
  await query("select public.contractor_submit_completion($1, $2, $3, $4)", [
    jobId,
    "Done.",
    "FT-PAID-1",
    CONTRACTOR.marcus,
  ]);
  await query("select public.admin_approve_job($1, $2)", [jobId, ADMIN_ID]);
  await query("select public.admin_mark_paid($1, $2, $3, $4)", [jobId, "ACH-1", "ACH", ADMIN_ID]);

  await assert.rejects(
    query("select public.admin_approve_expenses($1, 9999, 0, 0, 0, $2)", [jobId, ADMIN_ID]),
    /after a job has been paid/i,
  );
});

// ---------------------------------------------------------------------------
// What a contractor may and may not see
// ---------------------------------------------------------------------------

test("a contractor cannot read the customer price or the Mall Consultants share", async () => {
  // A priced job, offered to Marcus, so he can see the job itself.
  const jobId = await createPricedJob({ customerPriceCents: 12000 });
  await query("update public.jobs set status = 'offered' where id = $1", [jobId]);
  await query(
    `insert into public.job_offers (job_id, contractor_id, round, status, token_hash, expires_at)
     values ($1, $2, 1, 'delivered', $3, now() + interval '4 hours')`,
    [jobId, CONTRACTOR.marcus, sha256(`vis-${crypto.randomUUID()}`)],
  );

  // He can see the job.
  const visible = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select id from public.jobs where id = $1", [jobId]).then((r) => r.rows),
  );
  assert.equal(visible.length, 1, "the offer makes the job itself visible");

  // But not a cent of the customer side of it.
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select * from public.job_pricing where job_id = $1", [jobId]).then((r) => r.rows),
  );
  assert.equal(rows.length, 0, "job_pricing has no contractor-facing policy at all");

  const fin = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select * from public.job_financials where job_id = $1", [jobId]).then((r) => r.rows),
  );
  assert.equal(fin.length, 0, "the financial view must not become a way around that");
});

test("a contractor can read their own pay, mileage and expenses", async () => {
  const { jobId } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });

  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query(
        `select contractor_labor_pay_cents, mileage_payment_cents,
                total_expenses_cents, contractor_pay_cents
           from public.jobs where id = $1`,
        [jobId],
      )
      .then((r) => r.rows),
  );

  assert.equal(rows.length, 1);
  assert.equal(money(rows[0].contractor_labor_pay_cents), "500.00");
});

test("an administrator sees the full financial breakdown", async () => {
  const jobId = await createPricedJob({ customerPriceCents: 12000 });

  const rows = await asUser(ADMIN_ID, (c) =>
    c.query("select * from public.job_financials where job_id = $1", [jobId]).then((r) => r.rows),
  );

  assert.equal(rows.length, 1);
  const fin = rows[0];
  assert.equal(money(fin.lines_subtotal_cents), "120.00");
  assert.equal(money(fin.base_labor_total_cents), "120.00");
  assert.equal(money(fin.total_labor_revenue_cents), "120.00");
  assert.equal(money(fin.contractor_labor_pay_cents), "54.00");
  assert.equal(money(fin.mall_share_cents), "66.00");
  assert.equal(money(fin.mall_consultants_margin_cents), "66.00");
});

test("a contractor cannot read the split percentage or the mileage rate setting", async () => {
  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select key, value from public.app_settings").then((r) => r.rows),
  );
  assert.equal(
    rows.length,
    0,
    "knowing the percentage would let a contractor derive the customer price",
  );
});

test("a contractor cannot change the settings", async () => {
  const changed = await asUser(CONTRACTOR.marcus, (c) =>
    c
      .query("update public.app_settings set value = 9000 where key = 'contractor_percentage_bps'")
      .then((r) => r.rowCount),
  );
  assert.equal(changed, 0);
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

test("every catalogue price derives a contractor share correctly", async () => {
  const items = await query(
    `select code, customer_labor_price_cents, contractor_percentage_bps,
            contractor_labor_pay_cents, mall_share_cents
       from public.price_list_items where is_active`,
  );

  assert.ok(items.length > 100, `expected the full catalogue, saw ${items.length}`);

  for (const item of items) {
    assert.equal(
      item.contractor_labor_pay_cents + item.mall_share_cents,
      item.customer_labor_price_cents,
      `${item.code} must reconcile`,
    );
    assert.equal(
      item.contractor_labor_pay_cents,
      Math.round((item.customer_labor_price_cents * item.contractor_percentage_bps) / 10000),
      `${item.code} contractor share`,
    );
  }
});

test("negative catalogue prices are refused", async () => {
  await assert.rejects(
    query(
      `insert into public.price_list_items (code, name, customer_labor_price_cents)
       values ('BAD-NEGATIVE', 'Bad', -100)`,
    ),
    /customer_labor_price_cents/i,
  );
});

test("the catalogue keeps the zone install programs", async () => {
  const [row] = await query(
    "select count(*)::int as n from public.price_list_items where category = 'Zone Install Program'",
  );
  assert.ok(row.n >= 30, `expected the zone program list, saw ${row.n}`);
});

test.after(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------
// Several services on one job
// ---------------------------------------------------------------------------

/** Price a draft job with a list of [description, unitCents, quantity]. */
async function createMultiLineJob(lines) {
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, created_by
     ) values ('draft', 'Multi-line fixture', 'Fixture Customer', '1 Test Way',
               'Houston', 'TX', '77002', 'Fixture scope', $1)
     returning id`,
    [ADMIN_ID],
  );

  await query("insert into public.job_pricing (job_id) values ($1)", [job.id]);

  for (const [description, unit, quantity] of lines) {
    await query(
      `insert into public.job_service_lines (job_id, description, unit_price_cents, quantity)
       values ($1, $2, $3, $4)`,
      [job.id, description, unit, quantity],
    );
  }

  return job.id;
}

test("a job carries several priced services and sums them", async () => {
  const jobId = await createMultiLineJob([
    ["A-Program install", 12040, 1],
    ["Sink Rite Solo install", 9500, 1],
    ["Air gap", 2500, 2],
  ]);

  const pricing = await pricingOf(jobId);

  // 120.40 + 95.00 + (25.00 x 2)
  assert.equal(money(pricing.lines_subtotal_cents), "265.40");
  assert.equal(money(pricing.total_labor_revenue_cents), "265.40");
  assert.equal(money(pricing.contractor_labor_pay_cents), "119.43");
  assert.equal(money(pricing.mall_share_cents), "145.97");

  // The two shares still add back to the revenue exactly.
  assert.equal(
    pricing.contractor_labor_pay_cents + pricing.mall_share_cents,
    pricing.total_labor_revenue_cents,
  );
});

test("removing a service reprices the job", async () => {
  const jobId = await createMultiLineJob([
    ["A-Program install", 12040, 1],
    ["Sink Rite Solo install", 9500, 1],
    ["Air gap", 2500, 2],
  ]);

  await query("delete from public.job_service_lines where description = 'Air gap' and job_id = $1", [
    jobId,
  ]);

  const pricing = await pricingOf(jobId);
  assert.equal(money(pricing.lines_subtotal_cents), "215.40");
  assert.equal(money(pricing.contractor_labor_pay_cents), "96.93");
});

test("the labor subtotal cannot be written directly", async () => {
  const jobId = await createMultiLineJob([["A-Program install", 12040, 1]]);

  // Accepted, then overwritten from the lines: the figure a contractor is paid
  // from must come from the services on the job, not from whoever wrote last.
  await query("update public.job_pricing set lines_subtotal_cents = 999999 where job_id = $1", [
    jobId,
  ]);

  assert.equal(money((await pricingOf(jobId)).lines_subtotal_cents), "120.40");
});

test("a contractor cannot read the service lines", async () => {
  const jobId = await createMultiLineJob([["A-Program install", 12040, 1]]);
  await query("update public.jobs set status = 'offered' where id = $1", [jobId]);
  await query(
    `insert into public.job_offers (job_id, contractor_id, round, status, token_hash, expires_at)
     values ($1, $2, 1, 'delivered', $3, now() + interval '4 hours')`,
    [jobId, CONTRACTOR.marcus, sha256(`lines-${crypto.randomUUID()}`)],
  );

  const rows = await asUser(CONTRACTOR.marcus, (c) =>
    c.query("select * from public.job_service_lines where job_id = $1", [jobId]).then((r) => r.rows),
  );

  assert.equal(rows.length, 0, "the lines carry the customer price and are admin-only");
});
