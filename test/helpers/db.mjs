/**
 * Test helpers for talking to the local Postgres cluster.
 *
 * Two access modes matter:
 *   - `pool` / `query`      : superuser, bypasses RLS. Used for arranging fixtures.
 *   - `asUser(uuid, fn)`    : impersonates a signed-in Supabase user by switching
 *                             to the `authenticated` role and setting the JWT
 *                             claim that auth.uid() reads. This is the mode that
 *                             actually exercises row-level security.
 */
import crypto from "node:crypto";
import pg from "pg";
import { DATABASE_URL } from "../../scripts/local-db.mjs";

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 30 });

export const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
export const CONTRACTOR = {
  marcus: "22222222-2222-4222-8222-222222222201",
  dana: "22222222-2222-4222-8222-222222222202",
  priya: "22222222-2222-4222-8222-222222222203",
  tom: "22222222-2222-4222-8222-222222222204",
  alicia: "22222222-2222-4222-8222-222222222205",
  ray: "22222222-2222-4222-8222-222222222206",
};
export const SKILL = {
  ssdc: "33333333-3333-4333-8333-333333333301",
  lowVoltage: "33333333-3333-4333-8333-333333333302",
  fireAlarm: "33333333-3333-4333-8333-333333333303",
  lift: "33333333-3333-4333-8333-333333333304",
};

export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

/** Run `fn` with a client impersonating the given user id. */
export async function asUser(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    // set_config is used rather than SET LOCAL because the value is a parameter.
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** Run `fn` as an anonymous (signed-out) visitor. */
export async function asAnon(fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/**
 * Create a dispatchable job with a live offer round.
 *
 * Returns the job id plus the raw offer tokens, keyed by contractor id. The raw
 * tokens exist only here and in the SMS body in production, so tests hold them
 * the same way a contractor's phone would.
 */
export async function createOfferedJob({
  contractorIds,
  requiredSkillIds = [SKILL.ssdc],
  payCents = 50000,
  expiresInHours = 4,
  status = "offered",
  title = "Concurrency fixture job",
} = {}) {
  const [job] = await query(
    `insert into public.jobs (
       status, title, customer_name, address_line1, city, state_code, postal_code,
       scope, contractor_pay_cents, offer_expires_at, offer_round, created_by
     ) values (
       $1, $2, 'Fixture Customer', '1 Test Way', 'Houston', 'TX', '77002',
       'Fixture scope', $3, now() + ($4 || ' hours')::interval, 1, $5
     )
     returning id, job_number`,
    [status, title, payCents, String(expiresInHours), ADMIN_ID],
  );

  for (const skillId of requiredSkillIds) {
    await query(
      "insert into public.job_skills (job_id, skill_id) values ($1, $2) on conflict do nothing",
      [job.id, skillId],
    );
  }

  const tokens = {};
  for (const contractorId of contractorIds) {
    const raw = `tok-${crypto.randomUUID()}`;
    tokens[contractorId] = raw;
    await query(
      `insert into public.job_offers
         (job_id, contractor_id, round, status, token_hash, expires_at, sent_at)
       values ($1, $2, 1, 'delivered', $3, now() + ($4 || ' hours')::interval, now())`,
      [job.id, contractorId, sha256(raw), String(expiresInHours)],
    );
  }

  return { jobId: job.id, jobNumber: job.job_number, tokens };
}

/**
 * Create `count` approved contractors holding the given skills, so a race can
 * be run at a width the seed data does not cover.
 */
/**
 * Phone numbers are globally unique in the schema, and the test runner executes
 * each file in its own process -- so a per-module counter is not enough, since
 * every process would start it at the same value. Draw from a wide random range
 * instead, which is independent of how many processes are running.
 */
function uniquePhone() {
  return `+1${crypto.randomInt(2_000_000_000, 9_999_999_999)}`;
}

export async function createContractors(count, skillIds = [SKILL.ssdc]) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const id = crypto.randomUUID();
    const phone = uniquePhone();
    await query(
      `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `racer-${id}@example.test`],
    );
    await query(
      `insert into public.profiles (id, role, full_name, phone, is_active)
       values ($1, 'contractor', $2, $3, true)`,
      [id, `Racer ${i + 1}`, phone],
    );
    await query(
      `insert into public.contractors (id, status, approved_at, approved_by)
       values ($1, 'approved', now(), $2)`,
      [id, ADMIN_ID],
    );
    for (const skillId of skillIds) {
      await query(
        "insert into public.contractor_skills (contractor_id, skill_id) values ($1, $2)",
        [id, skillId],
      );
    }
    ids.push(id);
  }
  return ids;
}

export async function getJob(jobId) {
  const [job] = await query("select * from public.jobs where id = $1", [jobId]);
  return job;
}

export async function closePool() {
  await pool.end();
}
