import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The parser that runs inside the n8n Code node, tested here.
 *
 * It lives in a workflow JSON rather than in src/, which normally means it is
 * edited in a browser and verified by dragging an email around. That is a poor
 * place for the code that decides a contractor's destination address, so the
 * node's source is extracted from the workflow file and run against a real
 * mHelp assignment saved verbatim in test/fixtures.
 *
 * Two mistakes already found this way, both invisible in the n8n editor: the
 * message is a table rather than paragraphs, and Outlook sends "Luigi&#8217;s
 * Pizza" as often as it sends a real apostrophe -- which would have put an HTML
 * entity on a work order.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const workflow = JSON.parse(
  readFileSync(join(root, "automation/n8n/install-intake.workflow.json"), "utf8"),
);

const jsCode = workflow.nodes.find((n) => n.id === "extract")?.parameters?.jsCode;
const html = readFileSync(join(root, "test/fixtures/mhelp-assignment.html"), "utf8");

/** Run the node body the way n8n does: one function, one `$input`. */
function runNode(message) {
  const fn = new Function("$input", jsCode);
  return fn({ all: () => [{ json: message }] })[0].json;
}

const mhelpMessage = {
  id: "AAMkADI0NjhjOTVkLTFlMTUtNGQyYi1hNTg1",
  conversationId: "AAQkADI0NjhjOTVkLTFlMTU",
  subject: "#70069233 assigned to you: Job for Luigi’s Pizza - 509103264",
  from: { emailAddress: { address: "SSDC@mhelp.co" } },
  receivedDateTime: "2026-08-19T00:05:18Z",
  hasAttachments: false,
  body: { contentType: "html", content: html },
};

test("the workflow still carries a parser", () => {
  assert.ok(jsCode, "the extract node must exist and hold jsCode");
});

test("a real mHelp assignment is read field by field", () => {
  const out = runNode(mhelpMessage);

  assert.equal(out.customer_name, "Luigi’s Pizza - 509103264");
  assert.equal(out.installation_address, "16 Skyline Lake Drive");
  assert.equal(out.city, "Ringwood");
  assert.equal(out.state, "NJ");
  assert.equal(out.zip, "07456");
  assert.equal(out.site_contact_email, "ilforno1260@hotmail.com");
  assert.equal(out.work_order_number, "70069233");
  assert.equal(out.account_number, "509103264");
  assert.match(out.installation_notes, /^A Program, STD SR Solo \(gang\)/);
});

test("the address wraps onto a second line and still parses", () => {
  // "16 Skyline Lake Drive<br>Ringwood, NJ 07456" -- the city, state and ZIP
  // are on the line after the label, not beside it.
  const out = runNode(mhelpMessage);
  assert.ok(out.city && out.state && out.zip, "the wrapped line was read");
});

test("HTML entities do not reach the work order", () => {
  const out = runNode(mhelpMessage);
  assert.ok(
    !/&#\d+;|&[a-z]+;/i.test(out.customer_name),
    `customer name still holds an entity: ${out.customer_name}`,
  );
  assert.ok(!/&#\d+;/.test(out.raw_text), "the body still holds numeric entities");
});

test("the stylesheet does not end up in the stored email", () => {
  const out = runNode(mhelpMessage);
  assert.ok(
    !/font-family:Arial|pageContainer|margin:0px/.test(out.raw_text),
    "CSS leaked into raw_text",
  );
  assert.ok(out.raw_text.length < 3000, `raw_text is ${out.raw_text.length} chars`);
  assert.match(out.raw_text, /Account Name/, "but the useful text survived");
});

test("a complete assignment passes without review", () => {
  const out = runNode(mhelpMessage);
  assert.equal(out.needs_review, false);
  assert.deepEqual(out.missing_fields, []);
});

test("identity travels with the request", () => {
  const out = runNode(mhelpMessage);
  // The message id is the duplicate guard and the conversation id is what makes
  // an acknowledgment reply-all possible; losing either is silent.
  assert.equal(out.source_email_message_id, mhelpMessage.id);
  assert.equal(out.source_email_conversation_id, mhelpMessage.conversationId);
  assert.equal(out.source_email_sender, "SSDC@mhelp.co");
  assert.equal(out.source_email_received_at, "2026-08-19T00:05:18Z");
});

test("an email that is not an mHelp assignment goes to review", () => {
  const out = runNode({
    id: "OTHER",
    subject: "Install Request - Pucciarello's",
    from: { emailAddress: { address: "cmedeiros@example.com" } },
    hasAttachments: true,
    body: { content: "<p>Chris, is he getting a new machine or just a transfer?</p>" },
  });

  assert.equal(out.needs_review, true);
  assert.match(out.review_reason, /attachment|by hand/i);
  // Still delivered, never dropped: a request nobody can read is one to look at.
  assert.ok(out.raw_text.includes("new machine"));
});

test("a body Outlook could not supply does not produce an empty request", () => {
  const out = runNode({ id: "EMPTY", body: { content: "" }, bodyPreview: "" });
  assert.ok(out.raw_text.length > 0, "raw_text is never blank");
  assert.equal(out.needs_review, true);
});
