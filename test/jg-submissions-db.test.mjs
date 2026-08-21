import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_ID, CONTRACTOR, query } from "./helpers/db.mjs";

/**
 * The JG submission schema itself (0025) -- same shape as 0024's invoices,
 * proven the same way: real Postgres, not a trust in the SQL reading right.
 */

async function createFixtureJob() {
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, contractor_labor_pay_cents, assigned_contractor_id, assigned_at, created_by
     ) values (
       'approved', 'JG fixture job', 'Fixture Customer', '1 Test Way',
       'Houston', 'TX', '77002', 'Fixture scope', 10000, $1, now(), $2
     )
     returning id`,
    [CONTRACTOR.dana, ADMIN_ID],
  );
  return job.id;
}

test("the subtotal follows the lines, in both directions", async () => {
  const jobId = await createFixtureJob();
  const [submission] = await query(
    `insert into public.jg_submissions (job_id, created_by) values ($1, $2) returning id, lines_subtotal_cents`,
    [jobId, ADMIN_ID],
  );
  assert.equal(submission.lines_subtotal_cents, 0);

  const [line] = await query(
    `insert into public.jg_submission_lines (submission_id, category, description, unit_price_cents, quantity)
     values ($1, 'INSTALL EQUIPMENT', 'A-Program', 12040, 2) returning id`,
    [submission.id],
  );

  const [afterInsert] = await query(
    "select lines_subtotal_cents from public.jg_submissions where id = $1",
    [submission.id],
  );
  assert.equal(afterInsert.lines_subtotal_cents, 24080);

  await query("delete from public.jg_submission_lines where id = $1", [line.id]);
  const [afterDelete] = await query(
    "select lines_subtotal_cents from public.jg_submissions where id = $1",
    [submission.id],
  );
  assert.equal(afterDelete.lines_subtotal_cents, 0);
});

test("only one live submission can exist per job at a time", async () => {
  const jobId = await createFixtureJob();
  await query("insert into public.jg_submissions (job_id, created_by) values ($1, $2)", [jobId, ADMIN_ID]);

  await assert.rejects(
    () => query("insert into public.jg_submissions (job_id, created_by) values ($1, $2)", [jobId, ADMIN_ID]),
    /duplicate key|unique/i,
  );
});

test("a sent submission cannot be edited, and neither can its lines", async () => {
  const jobId = await createFixtureJob();
  const [submission] = await query(
    "insert into public.jg_submissions (job_id, created_by) values ($1, $2) returning id",
    [jobId, ADMIN_ID],
  );
  await query(
    `insert into public.jg_submission_lines (submission_id, category, description, unit_price_cents, quantity)
     values ($1, 'INSTALL EQUIPMENT', 'A-Program', 12040, 1)`,
    [submission.id],
  );

  await query("update public.jg_submissions set status = 'sent', sent_at = now() where id = $1", [
    submission.id,
  ]);

  await assert.rejects(
    () => query("update public.jg_submissions set account_name = 'Someone else' where id = $1", [submission.id]),
    /no longer a draft/,
  );

  await assert.rejects(
    () =>
      query(
        `insert into public.jg_submission_lines (submission_id, category, description, unit_price_cents, quantity)
         values ($1, 'OTHER', 'Sneaked in', 100, 1)`,
        [submission.id],
      ),
    /no longer a draft/,
  );
});

test("voiding a sent submission keeps sent_at as history, and reissuing works after", async () => {
  const jobId = await createFixtureJob();
  const [submission] = await query(
    "insert into public.jg_submissions (job_id, created_by, status, sent_at) values ($1, $2, 'sent', now()) returning id",
    [jobId, ADMIN_ID],
  );

  await query(
    "update public.jg_submissions set status = 'void', voided_at = now(), void_reason = 'wrong quantity' where id = $1",
    [submission.id],
  );
  const [voided] = await query(
    "select status, sent_at, void_reason from public.jg_submissions where id = $1",
    [submission.id],
  );
  assert.equal(voided.status, "void");
  assert.ok(voided.sent_at, "sent_at survives voiding, as history of when it actually went out");
  assert.equal(voided.void_reason, "wrong quantity");

  await query("insert into public.jg_submissions (job_id, created_by) values ($1, $2)", [jobId, ADMIN_ID]);
});
