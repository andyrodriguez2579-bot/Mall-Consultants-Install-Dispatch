import assert from "node:assert/strict";
import test from "node:test";
import {
  installRequestPayload,
  parseDateOnly,
  parseTimestamp,
  reviewVerdict,
} from "../src/lib/automation/install-request.ts";

/**
 * Intake decisions, tested away from the network.
 *
 * The judgement that matters is reviewVerdict: it decides whether an email an
 * AI read becomes work that can be dispatched, or a queue item a person looks
 * at. Getting it wrong in the permissive direction sends a contractor to an
 * address nobody checked, so the cases below are mostly about refusing.
 */

const complete = {
  source_email_message_id: "AAMkAGI2=",
  raw_text: "A Job has been assigned to you...",
  customer_name: "Three Bridges Cafe - 510245871",
  installation_address: "430 Main St",
  city: "Three Bridges",
  state: "NJ",
  zip: "08887",
};

test("a complete request needs no review", () => {
  const payload = installRequestPayload.parse(complete);
  const verdict = reviewVerdict(payload);
  assert.equal(verdict.needsReview, false);
  assert.equal(verdict.reason, null);
});

test("a missing address holds the request back", () => {
  const payload = installRequestPayload.parse({
    ...complete,
    installation_address: undefined,
  });
  const verdict = reviewVerdict(payload);
  assert.equal(verdict.needsReview, true);
  assert.match(verdict.reason, /installation address/);
});

test("every missing field is named, not just the first", () => {
  const payload = installRequestPayload.parse({
    source_email_message_id: "x",
    raw_text: "something arrived",
  });
  const verdict = reviewVerdict(payload);
  assert.equal(verdict.needsReview, true);
  for (const field of ["customer or site name", "installation address", "city", "state"]) {
    assert.ok(verdict.reason.includes(field), `expected "${field}" in: ${verdict.reason}`);
  }
});

test("a site name alone satisfies the naming requirement", () => {
  const payload = installRequestPayload.parse({
    ...complete,
    customer_name: undefined,
    site_name: "Ebb & Bloom Cafe",
  });
  assert.equal(reviewVerdict(payload).needsReview, false);
});

test("the workflow can demand a review even when everything parsed", () => {
  // The extractor knows things the field list cannot show -- a garbled
  // attachment, two addresses in one email -- so its own doubt wins.
  const payload = installRequestPayload.parse({
    ...complete,
    needs_review: true,
    review_reason: "Two addresses in the body.",
  });
  const verdict = reviewVerdict(payload);
  assert.equal(verdict.needsReview, true);
  assert.equal(verdict.reason, "Two addresses in the body.");
});

test("the message id and body are the only required fields", () => {
  assert.ok(installRequestPayload.safeParse({ source_email_message_id: "x", raw_text: "y" }).success);

  assert.equal(
    installRequestPayload.safeParse({ raw_text: "y" }).success,
    false,
    "without a message id there is no duplicate protection",
  );
  assert.equal(
    installRequestPayload.safeParse({ source_email_message_id: "x" }).success,
    false,
    "without the body there is no record of what was asked for",
  );
});

test("unknown fields are dropped rather than rejected", () => {
  // Adding a field in n8n must not start failing every request until the
  // application is redeployed.
  const parsed = installRequestPayload.parse({
    ...complete,
    something_new_from_n8n: "hello",
  });
  assert.equal("something_new_from_n8n" in parsed, false);
  assert.equal(parsed.city, "Three Bridges");
});

test("an unreadable date becomes null, never today", () => {
  // A wrong date on a work order sends someone to a site on the wrong day.
  assert.equal(parseDateOnly("next Tuesday-ish"), null);
  assert.equal(parseDateOnly(""), null);
  assert.equal(parseDateOnly(undefined), null);
  assert.equal(parseDateOnly("2026-07-30"), "2026-07-30");
  assert.equal(parseDateOnly("7/30/2026"), "2026-07-30");
});

test("timestamps survive the shapes Outlook sends", () => {
  assert.equal(
    parseTimestamp("2026-08-13T19:07:00Z"),
    "2026-08-13T19:07:00.000Z",
  );
  assert.equal(parseTimestamp("not a date"), null);
  assert.equal(parseTimestamp(undefined), null);
});

test("an oversized body is refused rather than truncated", () => {
  // Silent truncation would lose the part of the email that mattered.
  const huge = installRequestPayload.safeParse({
    ...complete,
    installation_notes: "x".repeat(20_001),
  });
  assert.equal(huge.success, false);
});
