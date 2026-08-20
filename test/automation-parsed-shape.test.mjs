import assert from "node:assert/strict";
import test from "node:test";
import { installRequestPayload } from "../src/lib/automation/install-request.ts";
import { toParsedRequest } from "../src/lib/automation/to-parsed.ts";

/**
 * The review screen reads a ParsedRequest, and reads it by exact name.
 *
 * The first automated request arrived with every field correctly extracted and
 * every box on screen empty, marked "not found -- please fill in", because the
 * endpoint stored its own flat shape: installation_address where the screen
 * looks for address_line1, state for state_code, zip for postal_code. Nothing
 * was lost and nothing errored, which is what made it hard to see.
 *
 * So these assert the names and the object shape, not just the values.
 */

const luigis = installRequestPayload.parse({
  source_email_message_id: "AAMkADI0",
  raw_text: "Account Name: Luigi's Pizza - 509103264 ...",
  customer_name: "Luigi's Pizza - 509103264",
  site_name: "Luigi's Pizza - 509103264",
  installation_address: "16 Skyline Lake Drive",
  city: "Ringwood",
  state: "nj",
  zip: "07456",
  site_contact_email: "ilforno1260@hotmail.com",
  work_order_number: "70069233",
  account_number: "509103264",
  installation_notes:
    "A Program, STD SR Solo (gang) for FC at 3CS. Ensure chemicals on-site, " +
    "location ready for install and location access BEFORE proceeding. Upon " +
    "completion, reply all through Original Installation Request Email. Upload " +
    "photos into mHelp and mark completed to expedite invoicing process.",
  review_reason: null,
});

test("every field the review screen reads is populated", () => {
  const parsed = toParsedRequest(luigis);

  // These names are the contract with review-form.tsx. Renaming one silently
  // empties a box on screen.
  assert.equal(parsed.customer_name?.value, "Luigi's Pizza - 509103264");
  assert.equal(parsed.site_name?.value, "Luigi's Pizza - 509103264");
  assert.equal(parsed.address_line1?.value, "16 Skyline Lake Drive");
  assert.equal(parsed.city?.value, "Ringwood");
  assert.equal(parsed.postal_code?.value, "07456");
  assert.equal(parsed.customer_reference?.value, "70069233");
});

test("each field is an object the screen can show provenance for", () => {
  const parsed = toParsedRequest(luigis);

  for (const key of ["customer_name", "address_line1", "city", "postal_code"]) {
    const field = parsed[key];
    assert.ok(field && typeof field === "object", `${key} must be an object`);
    assert.ok("value" in field, `${key} needs a value`);
    assert.ok("evidence" in field, `${key} needs evidence for the tooltip`);
    assert.ok(
      field.basis === "label" || field.basis === "pattern",
      `${key} needs a basis, got ${field.basis}`,
    );
  }
});

test("a state arrives upper case whatever the email said", () => {
  assert.equal(toParsedRequest(luigis).state_code?.value, "NJ");
});

test("a title is composed, and marked as inferred rather than quoted", () => {
  const parsed = toParsedRequest(luigis);
  assert.equal(parsed.title?.value, "SSDC installation - Luigi's Pizza, Ringwood");
  // No email carries a title, so claiming one was read would be a lie the
  // review screen shows to whoever is checking it.
  assert.equal(parsed.title?.basis, "pattern");
});

test("mHelp's own housekeeping is kept out of the scope", () => {
  const scope = toParsedRequest(luigis).scope;

  assert.match(scope, /^A Program, STD SR Solo \(gang\) for FC at 3CS\./);
  assert.match(scope, /chemicals on-site/);
  // Uploading photos into mHelp and closing the ticket is the sender's back
  // office, not work at the site, and means nothing to the contractor.
  assert.ok(!/Upload photos/i.test(scope), "mHelp housekeeping leaked into scope");
  assert.ok(!/reply all/i.test(scope), "reply-all instruction leaked into scope");
});

test("a missing field stays null rather than becoming an empty box", () => {
  const sparse = installRequestPayload.parse({
    source_email_message_id: "x",
    raw_text: "not much here",
  });
  const parsed = toParsedRequest(sparse);

  // null is what makes the screen say "not found -- please fill in", which is
  // the honest prompt; an empty object would read as a value nobody typed.
  assert.equal(parsed.customer_name, null);
  assert.equal(parsed.address_line1, null);
  assert.equal(parsed.title, null);
  assert.equal(parsed.scope, "");
  assert.deepEqual(parsed.suggestedItems, []);
});

test("a PO stands in when there is no work order", () => {
  const withPo = installRequestPayload.parse({
    source_email_message_id: "x",
    raw_text: "y",
    po_number: "PO-4417",
  });
  const parsed = toParsedRequest(withPo);
  assert.equal(parsed.customer_reference?.value, "PO-4417");
  assert.equal(parsed.customer_reference?.evidence, "PO number");
});
