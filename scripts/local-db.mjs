#!/usr/bin/env node
/**
 * Local Postgres harness.
 *
 * Spins up a throwaway PostgreSQL cluster and applies the exact same migration
 * files that ship to Supabase, on top of a small shim that recreates the parts
 * of the Supabase platform the migrations depend on (the `auth` and `storage`
 * schemas, the `anon` / `authenticated` / `service_role` roles).
 *
 * The point is that RLS policies and the acceptance-concurrency function are
 * exercised against real Postgres semantics -- real row locks, real parallel
 * connections -- rather than against a mock.
 *
 *   node scripts/local-db.mjs start | stop | reset | psql | url
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, ".localdb", "data");
const LOG_FILE = join(ROOT, ".localdb", "postgres.log");
const PORT = process.env.LOCAL_PG_PORT ?? "55432";
const HOST = "127.0.0.1";
const SUPERUSER = "postgres";
const DB_NAME = process.env.LOCAL_PG_DB ?? "dispatch_test";

export const DATABASE_URL = `postgres://${SUPERUSER}@${HOST}:${PORT}/${DB_NAME}`;

/** Locate the server binaries, which are not always on PATH. */
function binDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const candidates = [
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/15/bin",
    "/usr/lib/postgresql/14/bin",
    "/usr/local/pgsql/bin",
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "pg_ctl"))) return dir;
  }
  const which = spawnSync("which", ["pg_ctl"], { encoding: "utf8" });
  if (which.status === 0) return dirname(which.stdout.trim());
  throw new Error(
    "Could not find PostgreSQL server binaries. Set PG_BIN to the directory containing pg_ctl.",
  );
}

const BIN = binDir();
const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;

/**
 * initdb and pg_ctl refuse to run as root. When we are root -- the usual case
 * in a container -- drop to the `postgres` system account for server commands.
 */
function serverCmd(argv, { check = true } = {}) {
  const quoted = argv.map((a) => `'${String(a).replaceAll("'", "'\\''")}'`).join(" ");
  const result = runningAsRoot
    ? spawnSync("su", [SUPERUSER, "-c", quoted], { encoding: "utf8", stdio: "pipe" })
    : spawnSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: "pipe" });

  if (check && result.status !== 0) {
    throw new Error(
      `command failed: ${quoted}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function psql(args, { db = DB_NAME, check = true, stdio = "pipe" } = {}) {
  const result = spawnSync(
    "psql",
    ["-h", HOST, "-p", PORT, "-U", SUPERUSER, "-d", db, "-v", "ON_ERROR_STOP=1", ...args],
    { encoding: "utf8", stdio, env: { ...process.env, PGPASSWORD: "" } },
  );
  if (check && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`psql failed (${args.join(" ")}):\n${detail}`);
  }
  return result;
}

function isRunning() {
  const result = spawnSync(join(BIN, "pg_isready"), ["-h", HOST, "-p", PORT], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function start() {
  if (isRunning()) return;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(dirname(DATA_DIR), { recursive: true });
    // The postgres account has to own the cluster directory it initialises.
    chmodSync(dirname(DATA_DIR), 0o777);
    serverCmd([join(BIN, "initdb"), "-D", DATA_DIR, "-U", SUPERUSER, "--auth=trust", "-E", "UTF8"]);
  }

  serverCmd([
    join(BIN, "pg_ctl"),
    "-D", DATA_DIR,
    "-l", LOG_FILE,
    "-o", `-p ${PORT} -h ${HOST} -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    "-w",
    "start",
  ]);

  // Wait for readiness rather than assuming pg_ctl -w was enough.
  for (let i = 0; i < 50; i += 1) {
    if (isRunning()) return;
    spawnSync("sleep", ["0.2"]);
  }
  throw new Error(`Postgres did not become ready on ${HOST}:${PORT}. See ${LOG_FILE}`);
}

function stop() {
  if (!existsSync(DATA_DIR)) return;
  serverCmd([join(BIN, "pg_ctl"), "-D", DATA_DIR, "-m", "fast", "-w", "stop"], { check: false });
}

/** Drop the database and rebuild it from shim + migrations + seed. */
function reset({ seed = true } = {}) {
  start();

  psql(["-c", `drop database if exists ${DB_NAME} with (force)`], { db: "postgres" });
  psql(["-c", `create database ${DB_NAME}`], { db: "postgres" });

  const shim = join(ROOT, "test", "shim", "supabase_shim.sql");
  if (!existsSync(shim)) throw new Error(`missing Supabase shim at ${shim}`);
  psql(["-f", shim]);

  const migrationsDir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error("no migrations found");
  for (const file of files) {
    psql(["-f", join(migrationsDir, file)]);
  }

  if (seed) {
    const seedFile = join(ROOT, "supabase", "seed.sql");
    if (existsSync(seedFile)) psql(["-f", seedFile]);
  }

  return { migrations: files.length };
}

function main() {
  const command = process.argv[2] ?? "start";
  switch (command) {
    case "start":
      start();
      console.log(`postgres ready  ${DATABASE_URL}`);
      break;
    case "stop":
      stop();
      console.log("postgres stopped");
      break;
    case "reset": {
      const { migrations } = reset();
      console.log(`database rebuilt  (${migrations} migrations)  ${DATABASE_URL}`);
      break;
    }
    case "url":
      console.log(DATABASE_URL);
      break;
    case "psql":
      start();
      psql(process.argv.slice(3), { stdio: "inherit" });
      break;
    default:
      console.error(`unknown command: ${command}`);
      process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export { start, stop, reset, psql, isRunning };
