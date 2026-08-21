import assert from "node:assert/strict";
import test from "node:test";
import { invoiceEmail } from "../src/lib/email/invoice-template.ts";

const ORG = "Mall Consultants";

const summary = {
  invoiceNumber: 1001,
  jobNumber: "MC-4821",
  customerName: "Luigi's Pizza",
  siteAddress: "16 Skyline Lake Drive, Ringwood, NJ 07456",
  accountNumber: "509103264",
  billToName: "Luigi's Pizza",
  billToAddress: "16 Skyline Lake Drive, Ringwood, NJ 07456",
  notes: null,
};

const lines = [
  { description: "SSDC A-Program Installation", quantity: 1, unitPriceCents: 45000, lineTotalCents: 45000 },
  { description: "Mileage -- 40 payable miles at $0.7250", quantity: 1, unitPriceCents: 2900, lineTotalCents: 2900 },
];

test("the invoice number and job reference are in the subject", () => {
  const { subject } = invoiceEmail(summary, lines, 47900, ORG);
  assert.match(subject, /INV-1001/);
  assert.match(subject, /Luigi's Pizza/);
  assert.match(subject, /MC-4821/);
});

test("every line reads back with its quantity, unit price and total", () => {
  const { body } = invoiceEmail(summary, lines, 47900, ORG);
  assert.match(body, /SSDC A-Program Installation/);
  assert.match(body, /1 x \$450\.00 = \$450\.00/);
  assert.match(body, /Mileage -- 40 payable miles/);
});

test("the total is the subtotal passed in, not resummed from the lines", () => {
  // The caller (the database's own generated column) is the source of truth;
  // this only renders what it is given.
  const { body } = invoiceEmail(summary, lines, 47900, ORG);
  assert.match(body, /Total: \$479\.00/);
});

test("a fractional quantity is shown, not rounded away", () => {
  const { body } = invoiceEmail(
    summary,
    [{ description: "Labor", quantity: 1.5, unitPriceCents: 10000, lineTotalCents: 15000 }],
    15000,
    ORG,
  );
  assert.match(body, /1\.50 x \$100\.00 = \$150\.00/);
});

test("notes are included when present and omitted when not", () => {
  const withNotes = invoiceEmail({ ...summary, notes: "Net 30." }, lines, 47900, ORG);
  assert.match(withNotes.body, /Net 30\./);

  const withoutNotes = invoiceEmail(summary, lines, 47900, ORG);
  assert.ok(!withoutNotes.body.includes("null"), "a missing note must not print as the word null");
});

test("bill-to is shown only when there is one to show", () => {
  const noBillTo = invoiceEmail(
    { ...summary, billToName: null, billToAddress: null },
    lines,
    47900,
    ORG,
  );
  assert.ok(!/Bill to:/.test(noBillTo.body));
});

test("large totals get thousands separators", () => {
  const { body } = invoiceEmail(summary, lines, 1234567, ORG);
  assert.match(body, /Total: \$12,345\.67/);
});
