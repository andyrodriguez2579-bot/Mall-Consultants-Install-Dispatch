import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  readInstallContacts,
  readinessRecipients,
  splitCityStateZip,
} from "../src/lib/intake/workbook.ts";

/**
 * The contact block on an INSTALL sheet.
 *
 * The fixture is the header of a real request -- Skinny Louie Park Slope,
 * Brooklyn -- taken verbatim from the workbook. These addresses are who the
 * site-readiness email goes to, and getting one wrong means either a customer
 * hears nothing or someone who should not be on the thread is.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheet = JSON.parse(
  readFileSync(join(root, "test/fixtures/install-sheet-header.json"), "utf8"),
);

test("a real install sheet gives up its contacts", () => {
  const contacts = readInstallContacts(sheet);

  assert.equal(contacts.accountName, "Skinny Louie Park Slope");
  assert.equal(contacts.accountNumber, "56931964");
  assert.equal(contacts.streetAddress, "218 Flatbush Ave");
  assert.equal(contacts.customerName, "Fred Brea");
  assert.equal(contacts.customerEmail, "fredrick@skinnylouie.com");
  assert.equal(contacts.salesRepName, "Russell Arnold");
  assert.equal(contacts.salesRepEmail, "russell.arnold@pfgc.com");
  assert.equal(contacts.ssdcRepName, "Chris Medeiros");
  assert.equal(contacts.specialistEmail, "Irwin.Yaffe@pfgc.com");
  assert.equal(contacts.operatingCompany, "PFS- NY Metro");
});

test("the specialist's phone number does not end up in their name", () => {
  // The sheet holds "Irwin Yaffe - 609-744-6016" in one cell.
  assert.equal(readInstallContacts(sheet).specialistName, "Irwin Yaffe");
});

test("this sheet's city line splits despite the comma being in the wrong place", () => {
  // "Brooklyn NY, 11217" -- the comma sits before the ZIP here and after the
  // city on other forms. Both are in use and neither is a mistake anyone made.
  const contacts = readInstallContacts(sheet);
  assert.equal(contacts.city, "Brooklyn");
  assert.equal(contacts.stateCode, "NY");
  assert.equal(contacts.postalCode, "11217");
});

test("both city, state and ZIP conventions read the same way", () => {
  assert.deepEqual(splitCityStateZip("Brooklyn NY, 11217"), {
    city: "Brooklyn",
    stateCode: "NY",
    postalCode: "11217",
  });
  assert.deepEqual(splitCityStateZip("Ringwood, NJ 07456"), {
    city: "Ringwood",
    stateCode: "NJ",
    postalCode: "07456",
  });
  assert.deepEqual(splitCityStateZip("Three Bridges, NJ 08887-1234"), {
    city: "Three Bridges",
    stateCode: "NJ",
    postalCode: "08887-1234",
  });
  // A city of two words keeps both.
  assert.equal(splitCityStateZip("Little Falls, NJ 07424").city, "Little Falls");
  assert.deepEqual(splitCityStateZip(null), {
    city: null,
    stateCode: null,
    postalCode: null,
  });
});

test("the SSDC-only block on the right cannot answer for the customer", () => {
  // The same rows carry BREAKER:, VOLTAGE: and CONNECTION: further right. Only
  // the first column is read as a label, so those cannot be picked up.
  const contacts = readInstallContacts(sheet);
  for (const value of Object.values(contacts)) {
    if (typeof value !== "string") continue;
    assert.ok(
      !/^(Choose|BREAKER|VOLTAGE|CONNECTION)/i.test(value),
      `a field on the right leaked in: ${value}`,
    );
  }
});

test("an empty field is null rather than an empty string", () => {
  const contacts = readInstallContacts(sheet);
  // No machine was ordered on this one, and the form leaves those blank.
  assert.deepEqual(contacts.machineModels, []);
});

test("the readiness email reaches the customer, the sales rep and the RSM", () => {
  const contacts = readInstallContacts(sheet);
  const to = readinessRecipients(contacts, "chris.medeiros@ssdcsoap.com");

  assert.deepEqual(to, [
    "fredrick@skinnylouie.com",
    "russell.arnold@pfgc.com",
    "chris.medeiros@ssdcsoap.com",
  ]);
});

test("an RSM with no address on file simply does not receive it", () => {
  // The sheet names the SSDC rep but never gives an address, so it is looked
  // up from the roster. A missing one must not become an empty recipient.
  const to = readinessRecipients(readInstallContacts(sheet), null);
  assert.equal(to.length, 2);
  assert.ok(!to.includes(""));
  assert.ok(!to.includes(null));
});

test("the same address twice is only written once", () => {
  const to = readinessRecipients(
    {
      customerEmail: "Fred@Skinnylouie.com",
      salesRepEmail: "russell.arnold@pfgc.com",
    },
    "FRED@skinnylouie.com",
  );
  assert.deepEqual(to, ["Fred@Skinnylouie.com", "russell.arnold@pfgc.com"]);
});
