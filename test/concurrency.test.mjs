/**
 * Simultaneous-acceptance tests.
 *
 * The core promise of the dispatch model is that a job broadcast to many
 * contractors produces exactly one assignee, no matter how close together the
 * taps land. These tests attack that with genuinely parallel connections
 * against real Postgres, not a simulation of one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DATABASE_URL } from "../scripts/local-db.mjs";
import {
  CONTRACTOR,
  SKILL,
  closePool,
  createContractors,
  createOfferedJob,
  getJob,
  query,
  sha256,
} from "./helpers/db.mjs";

/**
 * Fire `accept_job_offer` from N independent connections as close to
 * simultaneously as the driver allows.
 *
 * Every client is connected and warmed first, so the measured window contains
 * only the RPC itself -- otherwise connection setup would stagger the calls and
 * quietly serialise the very thing under test.
 */
async function raceAcceptances(rawTokens) {
  const clients = rawTokens.map(
    () => new pg.Client({ connectionString: DATABASE_URL }),
  );
  await Promise.all(clients.map((c) => c.connect()));
  // Warm each connection so the first real statement is not paying for parse
  // and authentication latency.
  await Promise.all(clients.map((c) => c.query("select 1")));

  try {
    const settled = await Promise.all(
      clients.map((client, i) =>
        client
          .query("select * from public.accept_job_offer($1)", [sha256(rawTokens[i])])
          .then((r) => r.rows[0])
          .catch((err) => ({ result: "error", message: err.message })),
      ),
    );
    return settled;
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

const tally = (results) =>
  results.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] ?? 0) + 1;
    return acc;
  }, {});

test("exactly one contractor wins when three accept simultaneously", async () => {
  const contractorIds = [CONTRACTOR.marcus, CONTRACTOR.dana, CONTRACTOR.priya];
  const { jobId, tokens } = await createOfferedJob({ contractorIds });

  const results = await raceAcceptances(contractorIds.map((id) => tokens[id]));
  const counts = tally(results);

  assert.equal(counts.accepted, 1, `expected one winner, got ${JSON.stringify(counts)}`);
  assert.equal(counts.already_filled, 2, `expected two losers, got ${JSON.stringify(counts)}`);
  assert.equal(counts.error, undefined, "no acceptance should raise");

  const job = await getJob(jobId);
  assert.equal(job.status, "assigned");
  assert.ok(job.assigned_contractor_id, "job must have an assignee");
  assert.ok(job.assigned_at, "assignment must be timestamped");

  // The winner recorded in `jobs` must be the same contractor the RPC told.
  const winner = results.find((r) => r.result === "accepted");
  const [winningOffer] = await query(
    "select contractor_id from public.job_offers where id = $1",
    [winner.offer_id],
  );
  assert.equal(job.assigned_contractor_id, winningOffer.contractor_id);
});

test("exactly one contractor wins across a 16-way race", async () => {
  // Widen the race well past the seed roster to make a lost update more likely
  // to surface if the guard were wrong.
  const contractorIds = await createContractors(16, [SKILL.ssdc]);
  const { jobId, tokens } = await createOfferedJob({ contractorIds });

  const results = await raceAcceptances(contractorIds.map((id) => tokens[id]));
  const counts = tally(results);

  assert.equal(counts.accepted, 1, `expected exactly one winner, got ${JSON.stringify(counts)}`);
  assert.equal(counts.already_filled, 15, `expected 15 losers, got ${JSON.stringify(counts)}`);

  const job = await getJob(jobId);
  assert.equal(job.status, "assigned");

  // Precisely one offer may be in the 'accepted' state.
  const [{ accepted }] = await query(
    "select count(*)::int as accepted from public.job_offers where job_id = $1 and status = 'accepted'",
    [jobId],
  );
  assert.equal(accepted, 1);
});

test("repeated back-to-back races never double-assign", async () => {
  // Ten independent races. A lost update is a timing bug, so a single pass
  // proves less than a handful of consecutive ones.
  for (let round = 0; round < 10; round += 1) {
    const contractorIds = await createContractors(6, [SKILL.ssdc]);
    const { jobId, tokens } = await createOfferedJob({ contractorIds });

    const results = await raceAcceptances(contractorIds.map((id) => tokens[id]));
    const counts = tally(results);

    assert.equal(
      counts.accepted,
      1,
      `round ${round}: expected one winner, got ${JSON.stringify(counts)}`,
    );

    const job = await getJob(jobId);
    assert.equal(job.status, "assigned", `round ${round}: job must be assigned`);
  }
});

test("losing offers are marked filled and the winner's is marked accepted", async () => {
  const contractorIds = [CONTRACTOR.marcus, CONTRACTOR.dana, CONTRACTOR.priya];
  const { jobId, tokens } = await createOfferedJob({ contractorIds });

  await raceAcceptances(contractorIds.map((id) => tokens[id]));

  const rows = await query(
    "select status, count(*)::int as n from public.job_offers where job_id = $1 group by status",
    [jobId],
  );
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));

  assert.equal(byStatus.accepted, 1);
  assert.equal(byStatus.filled, 2);
});

test("a late acceptance on a filled job reports 'Job already filled'", async () => {
  const contractorIds = [CONTRACTOR.marcus, CONTRACTOR.dana];
  const { jobId, tokens } = await createOfferedJob({ contractorIds });

  const [first] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.marcus]),
  ]);
  assert.equal(first.result, "accepted");

  // Dana taps her link a minute later.
  const [second] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.dana]),
  ]);
  assert.equal(second.result, "already_filled");
  assert.equal(second.message, "Job already filled.");

  const job = await getJob(jobId);
  assert.equal(job.assigned_contractor_id, CONTRACTOR.marcus);
});

test("the winner re-tapping their own link is idempotent, not an error", async () => {
  const { tokens } = await createOfferedJob({ contractorIds: [CONTRACTOR.marcus] });

  const [first] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.marcus]),
  ]);
  const [again] = await query("select * from public.accept_job_offer($1)", [
    sha256(tokens[CONTRACTOR.marcus]),
  ]);

  assert.equal(first.result, "accepted");
  assert.equal(again.result, "accepted");
});

test("the audit log records exactly one acceptance per race", async () => {
  const contractorIds = await createContractors(8, [SKILL.ssdc]);
  const { jobId, tokens } = await createOfferedJob({ contractorIds });

  await raceAcceptances(contractorIds.map((id) => tokens[id]));

  const [{ accepted_events }] = await query(
    `select count(*)::int as accepted_events
       from public.audit_log
      where entity_id = $1 and action = 'offer.accepted'`,
    [jobId],
  );
  assert.equal(accepted_events, 1);

  // The database-level trigger must also have logged the assignment itself.
  const [{ assignment_events }] = await query(
    `select count(*)::int as assignment_events
       from public.audit_log
      where entity_id = $1 and action = 'job.assignment_changed'`,
    [jobId],
  );
  assert.equal(assignment_events, 1);
});

test.after(async () => {
  await closePool();
});
