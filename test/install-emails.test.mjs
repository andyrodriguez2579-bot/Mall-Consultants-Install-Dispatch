import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgmentEmail,
  installsDishMachine,
  siteReadinessEmail,
} from "../src/lib/email/install-templates.ts";

const ORG = "Mall Consultants";

/**
 * The two emails sent when a request arrives.
 *
 * These reach the customer, the RSM, the sales contact and the manager, so what
 * they promise matters as much as what they ask. In particular they must not
 * name a date: nothing is scheduled until a contractor accepts and picks a
 * window, and a date guessed here is a date somebody rearranges a kitchen
 * around.
 */

const luigis = {
  customerName: "Luigi's Pizza - 509103264",
  siteName: "Luigi's Pizza",
  addressLine: "16 Skyline Lake Drive",
  city: "Ringwood",
  stateCode: "NJ",
  postalCode: "07456",
  workOrderNumber: "70069233",
  accountNumber: "509103264",
  scope: "A Program, STD SR Solo (gang) for FC at 3CS. Ensure chemicals on-site.",
  siteContactName: null,
};

const withDishMachine = {
  ...luigis,
  scope: "Install single low temp dish machine and DM dispenser at the 3 comp sink.",
};

test("the acknowledgment reads the scope back", () => {
  const { body } = acknowledgmentEmail(luigis, ORG);
  assert.match(body, /A Program, STD SR Solo \(gang\)/);
  // Reading it back is how a wrong machine or a wrong address surfaces within
  // the hour rather than on the day.
  assert.match(body, /please reply and correct it before we schedule/i);
});

test("the acknowledgment asks about chemical delivery", () => {
  const { body } = acknowledgmentEmail(luigis, ORG);
  assert.match(body, /when the chemicals are due to be delivered/i);
});

test("no email promises a date", () => {
  for (const { body } of [acknowledgmentEmail(luigis, ORG), siteReadinessEmail(luigis, ORG)]) {
    assert.ok(
      !/\b(will arrive|scheduled for|on \w+day)\b/i.test(body),
      `an email committed to timing:\n${body}`,
    );
  }
  assert.match(
    acknowledgmentEmail(luigis, ORG).body,
    /as soon as the installation date and arrival window are confirmed/i,
  );
});

test("the reference and site travel on both emails", () => {
  for (const { body } of [acknowledgmentEmail(luigis, ORG), siteReadinessEmail(luigis, ORG)]) {
    assert.match(body, /Job 70069233/);
    assert.match(body, /Account 509103264/);
    assert.match(body, /16 Skyline Lake Drive, Ringwood, NJ/);
  }
});

test("a dish machine install asks the four expensive questions", () => {
  const { body } = siteReadinessEmail(withDishMachine, ORG);

  assert.match(body, /existing dish machine that needs to be removed/i);
  assert.match(body, /the overall area where the machine will go/i);
  assert.match(body, /the drain that will be used/i);
  assert.match(body, /the electrical supply that will be used/i);
  assert.match(body, /any stairs between the delivery entrance/i);
});

test("a job with no dish machine does not ask about drains", () => {
  const { body } = siteReadinessEmail(luigis, ORG);

  assert.ok(!/drain/i.test(body), "asked about a drain on a dispenser install");
  assert.ok(!/electrical supply/i.test(body), "asked about electrical needlessly");
  // Stairs and a photograph of the area still matter for anything delivered.
  assert.match(body, /any stairs/i);
  assert.match(body, /photograph of the overall area/i);
});

test("both emails require the area to be cleared and cleaned", () => {
  const { body } = siteReadinessEmail(luigis, ORG);
  assert.match(body, /cleared of equipment and wares and has been cleaned/i);
});

test("a dish machine is recognised however it is written", () => {
  for (const text of [
    "single low temp dish machine install",
    "DISHMACHINE swap out",
    "install DM at the 3 comp sink",
    "high-temp dishwasher",
    "DMI install",
  ]) {
    assert.ok(installsDishMachine(text), `missed: ${text}`);
  }
});

test("a dispenser-only install is not mistaken for one", () => {
  for (const text of [
    "A Program, STD SR Solo (gang) for FC at 3CS",
    "Install Sink-Rite Solo and Moprite III",
    "Remove all existing equipment & signage",
    null,
    "",
  ]) {
    assert.equal(installsDishMachine(text), false, `false positive: ${text}`);
  }
});

test("a request with almost nothing in it still produces a sendable email", () => {
  const bare = {
    customerName: null,
    siteName: null,
    addressLine: null,
    city: null,
    stateCode: null,
    postalCode: null,
    workOrderNumber: null,
    accountNumber: null,
    scope: null,
    siteContactName: null,
  };

  for (const { subject, body } of [acknowledgmentEmail(bare, ORG), siteReadinessEmail(bare, ORG)]) {
    assert.ok(subject.trim().length > 0, "a subject is always present");
    assert.ok(body.trim().length > 0, "a body is always present");
    // No dangling "for undefined" or empty label lines.
    assert.ok(!/\bnull\b|\bundefined\b/.test(body), `placeholder leaked:\n${body}`);
    assert.ok(!/:\s*$/m.test(body.replace(/^.*:\s*$/gm, (l) => (/^(Site|Job):/.test(l) ? "x" : l))));
  }
});
