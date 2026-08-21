import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_ID, CONTRACTOR, query } from "./helpers/db.mjs";

/**
 * The invoice schema itself (0024): the subtotal trigger, the freeze-on-send
 * trigger, and the one-live-invoice-per-job index. These are the actual
 * guarantee -- the server actions are a thin, best-effort layer in front of
 * them -- so they are worth exercising directly against real Postgres rather
 * than trusting the SQL reads correctly.
 */

async function createFixtureJob() {
  // 'approved' is one of the statuses that requires an assignee
  // (jobs_assigned_statuses_have_contractor), so this needs one even though
  // nothing here exercises assignment itself.
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, contractor_labor_pay_cents, assigned_contractor_id, assigned_at, created_by
     ) values (
       'approved', 'Invoice fixture job', 'Fixture Customer', '1 Test Way',
       'Houston', 'TX', '77002', 'Fixture scope', 10000, $1, now(), $2
     )
     returning id`,
    [CONTRACTOR.marcus, ADMIN_ID],
  );
  return job.id;
}

test("the subtotal follows the lines, in both directions", async () => {
  const jobId = await createFixtureJob();
  const [invoice] = await query(
    `insert into public.invoices (job_id, created_by) values ($1, $2) returning id, subtotal_cents`,
    [jobId, ADMIN_ID],
  );
  assert.equal(invoice.subtotal_cents, 0, "a fresh invoice with no lines starts at zero");

  const [line] = await query(
    `insert into public.invoice_line_items (invoice_id, description, unit_price_cents, quantity)
     values ($1, 'Install', 45000, 2) returning id`,
    [invoice.id],
  );

  const [afterInsert] = await query(
    "select subtotal_cents from public.invoices where id = $1",
    [invoice.id],
  );
  assert.equal(afterInsert.subtotal_cents, 90000, "trigger picks up a new line");

  await query("delete from public.invoice_line_items where id = $1", [line.id]);
  const [afterDelete] = await query(
    "select subtotal_cents from public.invoices where id = $1",
    [invoice.id],
  );
  assert.equal(afterDelete.subtotal_cents, 0, "trigger picks up a deleted line too");
});

test("only one live invoice can exist per job at a time", async () => {
  const jobId = await createFixtureJob();
  await query("insert into public.invoices (job_id, created_by) values ($1, $2)", [jobId, ADMIN_ID]);

  await assert.rejects(
    () => query("insert into public.invoices (job_id, created_by) values ($1, $2)", [jobId, ADMIN_ID]),
    /duplicate key|unique/i,
  );
});

test("a sent invoice cannot be edited, and neither can its lines", async () => {
  const jobId = await createFixtureJob();
  const [invoice] = await query(
    `insert into public.invoices (job_id, created_by) values ($1, $2) returning id`,
    [jobId, ADMIN_ID],
  );
  await query(
    `insert into public.invoice_line_items (invoice_id, description, unit_price_cents, quantity)
     values ($1, 'Install', 45000, 1)`,
    [invoice.id],
  );

  await query(
    "update public.invoices set status = 'sent', sent_at = now() where id = $1",
    [invoice.id],
  );

  await assert.rejects(
    () => query("update public.invoices set bill_to_name = 'Someone else' where id = $1", [invoice.id]),
    /no longer a draft/,
  );

  await assert.rejects(
    () =>
      query(
        `insert into public.invoice_line_items (invoice_id, description, unit_price_cents, quantity)
         values ($1, 'Sneaked in', 100, 1)`,
        [invoice.id],
      ),
    /no longer a draft/,
  );

  await assert.rejects(
    () =>
      query(
        "update public.invoice_line_items set unit_price_cents = 1 where invoice_id = $1",
        [invoice.id],
      ),
    /no longer a draft/,
  );
});

test("voiding is reachable from a sent invoice, and reissuing works after", async () => {
  const jobId = await createFixtureJob();
  const [invoice] = await query(
    `insert into public.invoices (job_id, created_by, status, sent_at) values ($1, $2, 'sent', now()) returning id`,
    [jobId, ADMIN_ID],
  );

  await query(
    "update public.invoices set status = 'void', voided_at = now(), void_reason = 'wrong total' where id = $1",
    [invoice.id],
  );
  const [voided] = await query("select status, void_reason from public.invoices where id = $1", [
    invoice.id,
  ]);
  assert.equal(voided.status, "void");
  assert.equal(voided.void_reason, "wrong total");

  // The unique index excludes void rows, so a fresh one can now be created for
  // the same job -- this is the reissue path.
  await query("insert into public.invoices (job_id, created_by) values ($1, $2)", [jobId, ADMIN_ID]);
});

test("invoice numbers are sequential and unique", async () => {
  const jobA = await createFixtureJob();
  const jobB = await createFixtureJob();

  const [a] = await query(
    "insert into public.invoices (job_id, created_by) values ($1, $2) returning invoice_number",
    [jobA, ADMIN_ID],
  );
  const [b] = await query(
    "insert into public.invoices (job_id, created_by) values ($1, $2) returning invoice_number",
    [jobB, ADMIN_ID],
  );

  assert.notEqual(a.invoice_number, b.invoice_number);
  assert.ok(b.invoice_number > a.invoice_number);
});

test("a draft invoice can be deleted, but a sent one cannot", async () => {
  const jobId = await createFixtureJob();
  const [draft] = await query(
    "insert into public.invoices (job_id, created_by) values ($1, $2) returning id",
    [jobId, ADMIN_ID],
  );
  await query("delete from public.invoices where id = $1", [draft.id]);

  const [sent] = await query(
    "insert into public.invoices (job_id, created_by, status, sent_at) values ($1, $2, 'sent', now()) returning id",
    [jobId, ADMIN_ID],
  );
  await assert.rejects(
    () => query("delete from public.invoices where id = $1", [sent.id]),
    /only be deleted while still a draft/,
  );
});
