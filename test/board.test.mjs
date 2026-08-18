import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ID,
  CONTRACTOR,
  SKILL,
  asUser,
  closePool,
  createContractors,
  createOfferedJob,
  getJob,
  pool,
  query,
} from "./helpers/db.mjs";

/**
 * The open board.
 *
 * Two properties matter here, and neither is visible from the page. A job left
 * standing on the board must be readable by every approved contractor and by
 * nobody else, and two contractors claiming at the same instant must produce
 * exactly one winner -- settled by the database, not by whichever request
 * happened to arrive first.
 *
 * The seed roster already covers every branch of eligibility (Marcus, Dana and
 * Priya approved and qualified; Tom approved but uncertified; Alicia pending;
 * Ray suspended), so these read it rather than editing it. A test that has to
 * suspend somebody to make its point leaves the next test a different database.
 */

async function postBoardJob({ title = "Board fixture", skills = [SKILL.ssdc] } = {}) {
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, contractor_labor_pay_cents, board_posted_at, created_by
     ) values (
       'ready', $1, 'Board Customer', '9 Board Way', 'Houston', 'TX', '77002',
       'Board scope', 40000, now(), $2
     )
     returning id`,
    [title, ADMIN_ID],
  );

  for (const skillId of skills) {
    await query(
      "insert into public.job_skills (job_id, skill_id) values ($1, $2) on conflict do nothing",
      [job.id, skillId],
    );
  }

  return job.id;
}

const visibleTo = (contractorId, jobId) =>
  asUser(contractorId, (c) =>
    c.query("select id from public.jobs where id = $1", [jobId]).then((r) => r.rows),
  );

test("an approved contractor sees an unclaimed board job", async () => {
  const jobId = await postBoardJob({ title: "Visible on the board" });

  const rows = await visibleTo(CONTRACTOR.marcus, jobId);
  assert.equal(rows.length, 1, "no offer was ever created, and it is still visible");
});

test("a suspended contractor sees nothing on the board", async () => {
  const jobId = await postBoardJob({ title: "Not for the suspended" });

  const rows = await visibleTo(CONTRACTOR.ray, jobId);
  assert.equal(rows.length, 0, "the board is for approved contractors only");
});

test("a contractor awaiting approval sees nothing on the board", async () => {
  const jobId = await postBoardJob({ title: "Not for the pending" });

  const rows = await visibleTo(CONTRACTOR.alicia, jobId);
  assert.equal(rows.length, 0, "approval is what opens the board, not signing up");
});

test("a claimed job leaves the board for everyone else", async () => {
  const jobId = await postBoardJob({ title: "Claimed and gone" });

  const [claim] = await query("select * from public.claim_board_job($1, $2)", [
    jobId,
    CONTRACTOR.dana,
  ]);
  assert.equal(claim.result, "accepted");

  const job = await getJob(jobId);
  assert.equal(job.status, "assigned");
  assert.equal(job.assigned_contractor_id, CONTRACTOR.dana);
  assert.ok(job.assigned_at, "assignment records when, as the CHECK requires");

  assert.equal(
    (await visibleTo(CONTRACTOR.marcus, jobId)).length,
    0,
    "it is off the board now",
  );
  assert.equal(
    (await visibleTo(CONTRACTOR.dana, jobId)).length,
    1,
    "the person who took it still has it",
  );
});

test("claiming twice is not an error for the person who won", async () => {
  const jobId = await postBoardJob({ title: "Double tap" });

  await query("select * from public.claim_board_job($1, $2)", [jobId, CONTRACTOR.dana]);
  const [again] = await query("select * from public.claim_board_job($1, $2)", [
    jobId,
    CONTRACTOR.dana,
  ]);

  assert.equal(again.result, "accepted");
  assert.match(again.message, /already have this job/i);
});

test("a contractor without the certification cannot claim", async () => {
  // Tom is approved and active; the only thing he lacks is the SSDC skill.
  const jobId = await postBoardJob({ title: "Needs a certification" });

  const [claim] = await query("select * from public.claim_board_job($1, $2)", [
    jobId,
    CONTRACTOR.tom,
  ]);

  assert.equal(claim.result, "not_eligible");
  assert.match(claim.message, /certification/i);

  const job = await getJob(jobId);
  assert.equal(job.assigned_contractor_id, null, "the job stays open for someone else");
});

test("a suspended contractor cannot claim even knowing the id", async () => {
  const jobId = await postBoardJob({ title: "Suspended cannot claim" });

  const [claim] = await query("select * from public.claim_board_job($1, $2)", [
    jobId,
    CONTRACTOR.ray,
  ]);

  assert.equal(claim.result, "not_eligible");
  const job = await getJob(jobId);
  assert.equal(job.assigned_contractor_id, null);
});

test("a job never posted to the board cannot be claimed", async () => {
  const { jobId } = await createOfferedJob({
    contractorIds: [CONTRACTOR.dana],
    title: "Dispatch only",
  });

  const [claim] = await query("select * from public.claim_board_job($1, $2)", [
    jobId,
    CONTRACTOR.dana,
  ]);

  assert.equal(claim.result, "job_not_open");
});

test("twelve contractors claiming at once produce exactly one winner", async () => {
  const jobId = await postBoardJob({ title: "The stampede" });
  const contractors = await createContractors(12);

  // Each claim goes out on its own connection and they are released together,
  // so the database is genuinely resolving concurrent attempts rather than a
  // queue the test built for it.
  const clients = await Promise.all(contractors.map(() => pool.connect()));

  try {
    const results = await Promise.all(
      clients.map((client, index) =>
        client
          .query("select * from public.claim_board_job($1, $2)", [
            jobId,
            contractors[index],
          ])
          .then((r) => r.rows[0].result),
      ),
    );

    assert.equal(
      results.filter((r) => r === "accepted").length,
      1,
      `exactly one winner, got ${results.filter((r) => r === "accepted").length}`,
    );
    assert.equal(
      results.filter((r) => r === "already_filled").length,
      11,
      "everyone else is told it is filled, not left guessing",
    );
  } finally {
    for (const client of clients) client.release();
  }

  const job = await getJob(jobId);
  assert.equal(job.status, "assigned");
  assert.ok(contractors.includes(job.assigned_contractor_id));
});

test.after(() => closePool());
