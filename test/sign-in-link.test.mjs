import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A single-use sign-in link must not be spent by rendering the page it points
 * at.
 *
 * Messaging apps fetch the URL to build the preview card shown under a text,
 * and mail providers fetch it to scan for malware. Both are GETs, and both
 * happen before the person the link belongs to has touched it. When the page
 * redeemed on render, that traffic consumed every link in transit and the first
 * real tap reported -- accurately -- that it had already been used.
 *
 * The rule this pins down: the page reads state, the form submission spends it.
 * It is a source check rather than a behavioural one because the alternative
 * needs a running Next server and a Supabase client, and the mistake this
 * guards against is a one-line import, made in exactly this file.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = "src/app/auth/link/[token]";

const read = (file) => readFileSync(join(root, dir, file), "utf8");

test("the sign-in link page does not redeem on render", () => {
  const page = read("page.tsx");

  assert.ok(
    !/redeemSignInLink/.test(page),
    "page.tsx must not call redeemSignInLink: rendering is a GET, and link " +
      "previewers and mail scanners issue GETs before the recipient taps " +
      "anything. Read the token with inspectSignInLink and spend it in the " +
      "form action instead.",
  );

  assert.ok(
    !/establishSession/.test(page),
    "page.tsx must not establish a session on render, for the same reason",
  );

  assert.ok(
    /inspectSignInLink/.test(page),
    "page.tsx should read the token's state with inspectSignInLink",
  );
});

test("the token is spent by a form submission", () => {
  const actions = read("actions.ts");

  assert.ok(/"use server"/.test(actions), "redemption runs on the server");
  assert.ok(
    /redeemSignInLink/.test(actions),
    "the action is where the token is actually consumed",
  );
  assert.ok(
    /establishSession/.test(actions),
    "the action is where the session is established",
  );
});

test("inspecting a token leaves it unspent", () => {
  const source = readFileSync(join(root, "src/lib/passwordless.ts"), "utf8");
  const start = source.indexOf("export async function inspectSignInLink");
  assert.ok(start > -1, "inspectSignInLink exists");

  const end = source.indexOf("export async function", start + 10);
  const body = source.slice(start, end === -1 ? undefined : end);

  // Writes only. `used_at` appears in the row's type annotation, which is a
  // read of the column, not a claim on it.
  for (const write of [".update(", ".insert(", ".upsert(", ".delete(", ".rpc("]) {
    assert.ok(
      !body.includes(write),
      `inspectSignInLink must not call ${write} -- it reports on the token, ` +
        "it does not claim it",
    );
  }
});
