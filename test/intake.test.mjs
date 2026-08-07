/**
 * Install request extraction tests.
 *
 * Pure function, no database. These run against text shaped like the requests
 * the business actually receives -- a tidy work order, a forwarded email, a
 * scribbled phone note -- because that is where a parser earns or loses trust.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { matchLineItems, parseInstallRequest } from "../src/lib/intake/parse.ts";

const PRICE_LIST = [
  { code: "SSDC-INSTALL", name: "SSDC unit install" },
  { code: "SSDC-SWAP", name: "SSDC unit replacement" },
  { code: "SSDC-BOARD", name: "Controller board swap" },
  { code: "SSDC-COMMISH", name: "Commissioning only" },
  { code: "LV-RUN", name: "Low voltage run" },
  { code: "FA-INTERFACE", name: "Fire alarm interface" },
  { code: "LIFT-DAY", name: "Lift day rate" },
  { code: "TRIP-EMERG", name: "Emergency call-out" },
];

// ---------------------------------------------------------------------------
// A structured work order
// ---------------------------------------------------------------------------

const STRUCTURED = `
Work Order: SSDC retrofit - north vestibule
Customer: Simon Property Group
Site: Memorial City Mall
Address: 303 Memorial City Way, Houston, TX 77024
Contact: Danielle Ruiz 713-555-0199
PO#: 44821
Date: 4/22/2026 8:00 AM
Deadline: 4/24/2026
Scope: Replace 2 SSDC units in the north vestibule and re-commission.
`;

test("a structured work order is read field by field", () => {
  const parsed = parseInstallRequest(STRUCTURED, PRICE_LIST);

  assert.equal(parsed.customer_name?.value, "Simon Property Group");
  assert.equal(parsed.site_name?.value, "Memorial City Mall");
  assert.equal(parsed.address_line1?.value, "303 Memorial City Way");
  assert.equal(parsed.city?.value, "Houston");
  assert.equal(parsed.state_code?.value, "TX");
  assert.equal(parsed.postal_code?.value, "77024");
  assert.equal(parsed.site_contact_name?.value, "Danielle Ruiz");
  assert.equal(parsed.site_contact_phone?.value, "+17135550199");
  assert.equal(parsed.customer_reference?.value, "44821");
  assert.equal(parsed.missing.length, 0, "nothing required should be missing");
});

test("every extracted field carries the text it came from", () => {
  const parsed = parseInstallRequest(STRUCTURED, PRICE_LIST);

  assert.match(parsed.customer_name.evidence, /Simon Property Group/);
  assert.equal(parsed.customer_name.basis, "label");
  assert.match(parsed.site_contact_phone.evidence, /713/);
});

test("a labelled date is read with its time of day", () => {
  const parsed = parseInstallRequest(STRUCTURED, PRICE_LIST);
  const start = new Date(parsed.scheduled_start.value);

  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 3, "April");
  assert.equal(start.getDate(), 22);
  assert.equal(start.getHours(), 8);

  const due = new Date(parsed.deadline_at.value);
  assert.equal(due.getDate(), 24);
});

// ---------------------------------------------------------------------------
// Loose prose
// ---------------------------------------------------------------------------

test("an unstructured email still yields an address and a phone number", () => {
  const email = `
Hi - we need someone out to Baybrook Mall next week.

500 Baybrook Mall
Friendswood, TX 77546

Six SSDC units need commissioning in the food court. Ask for Marcus at the
management office, 281-555-0143. Needs to be done by April 30, 2026.
`;

  const parsed = parseInstallRequest(email, PRICE_LIST);

  assert.equal(parsed.address_line1?.value, "500 Baybrook Mall");
  assert.equal(parsed.city?.value, "Friendswood");
  assert.equal(parsed.state_code?.value, "TX");
  assert.equal(parsed.postal_code?.value, "77546");
  assert.equal(parsed.site_contact_phone?.value, "+12815550143");
  assert.equal(parsed.address_line1.basis, "pattern", "inferred, not labelled");

  // The customer was never stated, and the parser must say so rather than guess.
  assert.equal(parsed.customer_name, null);
  assert.ok(parsed.missing.includes("Customer"));
});

test("the whole request becomes the scope when none is labelled", () => {
  const parsed = parseInstallRequest("Swap the failed unit at Deerbrook.", PRICE_LIST);
  assert.match(parsed.scope, /Deerbrook/);
});

// ---------------------------------------------------------------------------
// Work item matching
// ---------------------------------------------------------------------------

test("digit quantities are read from the request", () => {
  const items = matchLineItems("Replace 2 SSDC units in the north vestibule.", PRICE_LIST);
  const swap = items.find((i) => i.code === "SSDC-SWAP");
  assert.ok(swap, "should recognise a replacement");
  assert.equal(swap.quantity, 2);
});

test("parenthesised and word quantities are read", () => {
  const parens = matchLineItems("Install (3) SSDC units at the east entry.", PRICE_LIST);
  assert.equal(parens.find((i) => i.code === "SSDC-INSTALL")?.quantity, 3);

  const words = matchLineItems("Please commission four units.", [
    { code: "SSDC-COMMISH", name: "Commissioning only" },
  ]);
  assert.equal(words.find((i) => i.code === "SSDC-COMMISH")?.quantity, 4);
});

test("a more specific work item wins over a general one", () => {
  // "controller board" must not also register as a whole-unit replacement.
  const items = matchLineItems("Replace the controller board on unit 3.", PRICE_LIST);
  const codes = items.map((i) => i.code);

  assert.ok(codes.includes("SSDC-BOARD"), "the board swap should be suggested");
  assert.ok(!codes.includes("SSDC-SWAP"), "a unit replacement should not also be suggested");
});

test("several different work items are suggested from one request", () => {
  const items = matchLineItems(
    "Install 2 SSDC units, pull 4 cable runs back to the IDF, and interface with the fire alarm panel. Scissor lift required.",
    PRICE_LIST,
  );
  const byCode = Object.fromEntries(items.map((i) => [i.code, i.quantity]));

  assert.equal(byCode["SSDC-INSTALL"], 2);
  assert.equal(byCode["LV-RUN"], 4);
  assert.ok(byCode["FA-INTERFACE"], "fire alarm work should be recognised");
  assert.ok(byCode["LIFT-DAY"], "lift requirement should be recognised");
});

test("an emergency call-out is recognised from ordinary wording", () => {
  const items = matchLineItems("Unit failed closed - need someone same day.", PRICE_LIST);
  assert.ok(items.some((i) => i.code === "TRIP-EMERG"));
});

test("a street number is not mistaken for a quantity", () => {
  const items = matchLineItems(
    "Address: 303 Memorial City Way\nCommissioning only, one unit.",
    PRICE_LIST,
  );
  const commish = items.find((i) => i.code === "SSDC-COMMISH");
  assert.ok(commish);
  assert.equal(commish.quantity, 1, "should read 'one', not the street number");
});

test("repeat mentions of the same item accumulate", () => {
  const items = matchLineItems(
    "Install 2 SSDC units on level one.\nAlso install 3 SSDC units on level two.",
    PRICE_LIST,
  );
  assert.equal(items.find((i) => i.code === "SSDC-INSTALL")?.quantity, 5);
});

test("an empty price list yields no suggestions rather than throwing", () => {
  const parsed = parseInstallRequest(STRUCTURED, []);
  assert.deepEqual(parsed.suggestedItems, []);
});

// ---------------------------------------------------------------------------
// Refusing to guess
// ---------------------------------------------------------------------------

test("an impossible date is left blank rather than invented", () => {
  const parsed = parseInstallRequest("Customer: Acme\nDate: 2/31/2026", PRICE_LIST);
  assert.equal(parsed.scheduled_start, null, "31 February is not a date");
});

test("a ZIP code in an address line is not read as a date", () => {
  const parsed = parseInstallRequest(
    "Customer: Acme\nAddress: 1 Test Way, Houston, TX 77002",
    PRICE_LIST,
  );
  assert.equal(parsed.scheduled_start, null);
  assert.equal(parsed.postal_code?.value, "77002");
});

test("missing required fields are reported for the review screen", () => {
  const parsed = parseInstallRequest("Someone call me about the mall job.", PRICE_LIST);

  for (const expected of ["Customer", "Street address", "City", "State", "ZIP"]) {
    assert.ok(parsed.missing.includes(expected), `${expected} should be flagged missing`);
  }
});

test("empty input does not throw", () => {
  const parsed = parseInstallRequest("", PRICE_LIST);
  assert.equal(parsed.scope, "");
  assert.equal(parsed.missing.length, 5);
});
