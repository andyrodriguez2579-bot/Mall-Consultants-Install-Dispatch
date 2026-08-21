import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgmentEmail,
  composeDraftEmails,
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

test("the dish machine questions are asked as a condition, not a branch", () => {
  // Every readiness email carries them. Whether a machine is involved is not
  // reliably legible from the paperwork, so the person standing in the kitchen
  // decides rather than a parser guessing from an abbreviation.
  for (const summary of [luigis, withDishMachine]) {
    const { body } = siteReadinessEmail(summary, ORG);

    assert.match(body, /If a dish machine is part of this installation/i);
    assert.match(body, /existing dish machine that needs to be removed/i);
    assert.match(body, /photograph of the overall area/i);
    assert.match(body, /photograph of the drain that will be used/i);
    assert.match(body, /photograph of the electrical supply/i);
    assert.match(body, /stairs between the delivery entrance/i);
  }
});

test("the readiness email requires the area cleared and cleaned", () => {
  const { body } = siteReadinessEmail(luigis, ORG);
  assert.match(body, /cleared of equipment and wares and has been cleaned/i);
});

test("both emails ask when the chemicals arrive", () => {
  // Without them on site the trip is wasted, so it is asked twice on purpose.
  for (const { body } of [acknowledgmentEmail(luigis, ORG), siteReadinessEmail(luigis, ORG)]) {
    assert.match(body, /chemicals are due to be delivered/i);
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
    // No "for undefined", and no labelled line left standing with nothing
    // after it -- a bare "Site:" reads as information that went missing.
    assert.ok(!/\bnull\b|\bundefined\b/.test(body), `placeholder leaked:\n${body}`);
    assert.ok(
      !/^(Site|Job|Account)\s*:\s*$/m.test(body),
      `an empty labelled line was printed:\n${body}`,
    );
  }
});

/**
 * What gets drafted, decided by what is actually known.
 *
 * A request with neither a thread to reply into nor a real readiness
 * recipient produces nothing -- there is no one to send either email to, and
 * a row with an empty `to_emails` fails the database's own check constraint.
 */

test("a reply thread produces exactly an acknowledgment", () => {
  const rows = composeDraftEmails({
    summary: luigis,
    orgName: ORG,
    replyThread: {
      toEmail: "requester@ssdcsoap.com",
      messageId: "AAMk-1",
      conversationId: "conv-1",
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "acknowledgment");
  assert.deepEqual(rows[0].to_emails, ["requester@ssdcsoap.com"]);
  assert.equal(rows[0].reply_to_message_id, "AAMk-1");
  assert.equal(rows[0].conversation_id, "conv-1");
  assert.match(rows[0].body, /A Program, STD SR Solo \(gang\)/);
});

test("readiness recipients produce exactly a site-readiness note", () => {
  const rows = composeDraftEmails({
    summary: luigis,
    orgName: ORG,
    readinessRecipients: ["fred@skinnylouie.com", "russell.arnold@pfgc.com", null],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "site_readiness");
  assert.deepEqual(rows[0].to_emails, ["fred@skinnylouie.com", "russell.arnold@pfgc.com"]);
  assert.equal(rows[0].reply_to_message_id, null);
});

test("both can be drafted for the same request", () => {
  const rows = composeDraftEmails({
    summary: luigis,
    orgName: ORG,
    replyThread: { toEmail: "requester@ssdcsoap.com", messageId: null, conversationId: null },
    readinessRecipients: ["fred@skinnylouie.com"],
  });

  assert.deepEqual(
    rows.map((r) => r.kind).sort(),
    ["acknowledgment", "site_readiness"],
  );
});

test("nothing is drafted without a thread or a real recipient", () => {
  assert.deepEqual(composeDraftEmails({ summary: luigis, orgName: ORG }), []);
  assert.deepEqual(
    composeDraftEmails({
      summary: luigis,
      orgName: ORG,
      replyThread: { toEmail: "not-an-email", messageId: null, conversationId: null },
      readinessRecipients: [null, ""],
    }),
    [],
  );
});
