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

test("an explicit null is accepted wherever a value is optional", () => {
  // What the live workflow actually sends. A parser written to be honest about
  // what it could not find emits null, not undefined, and rejecting the whole
  // request over one deliberate blank threw away the email entirely -- which is
  // how this was found, on the first real send.
  const fromN8n = {
    source_email_message_id: "AAMkADI0NjhjOTVkLTFlMTUtNGQyYi1hNTg1",
    source_email_conversation_id: "AAQkADI0NjhjOTVk",
    source_email_subject: "#70069233 assigned to you: Job for Luigi's Pizza",
    source_email_sender: "SSDC@mhelp.co",
    source_email_received_at: "2026-08-19T00:05:18Z",
    raw_text: "Account Name: Luigi's Pizza - 509103264 ...",
    customer_name: "Luigi's Pizza - 509103264",
    site_name: "Luigi's Pizza - 509103264",
    installation_address: "16 Skyline Lake Drive",
    city: "Ringwood",
    state: "NJ",
    zip: "07456",
    site_contact_email: "ilforno1260@hotmail.com",
    work_order_number: "70069233",
    account_number: "509103264",
    installation_notes: "A Program, STD SR Solo (gang) for FC at 3CS.",
    missing_fields: [],
    needs_review: false,
    review_reason: null,
  };

  const parsed = installRequestPayload.safeParse(fromN8n);
  assert.ok(
    parsed.success,
    `the live payload was rejected: ${JSON.stringify(parsed.error?.issues)}`,
  );
  assert.equal(reviewVerdict(parsed.data).needsReview, false);
});

test("a null in every optional field is still a valid request", () => {
  const parsed = installRequestPayload.safeParse({
    source_email_message_id: "x",
    raw_text: "an email nobody could read",
    customer_name: null,
    site_name: null,
    installation_address: null,
    city: null,
    state: null,
    zip: null,
    site_contact_name: null,
    site_contact_email: null,
    site_contact_phone: null,
    equipment_type: null,
    equipment_model: null,
    work_order_number: null,
    po_number: null,
    account_number: null,
    requested_completion_date: null,
    required_by_date: null,
    installation_notes: null,
    prime_contractor: null,
    operating_company: null,
    rsm_name: null,
    missing_fields: null,
    needs_review: null,
    review_reason: null,
  });

  assert.ok(parsed.success, "nothing readable is still something to record");
  // ...and it lands in the review queue rather than being dropped.
  assert.equal(reviewVerdict(parsed.data).needsReview, true);
});

test("a null date is a blank, not a crash", () => {
  assert.equal(parseDateOnly(null), null);
  assert.equal(parseTimestamp(null), null);
});

test("an oversized body is refused rather than truncated", () => {
  // Silent truncation would lose the part of the email that mattered.
  const huge = installRequestPayload.safeParse({
    ...complete,
    installation_notes: "x".repeat(20_001),
  });
  assert.equal(huge.success, false);
});
