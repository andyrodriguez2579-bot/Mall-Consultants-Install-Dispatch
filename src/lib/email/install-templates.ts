/**
 * The two emails that go out when an installation request arrives.
 *
 * Both are plain text. These are replies into threads that already carry six to
 * ten people on mixed clients, and a text reply quotes and forwards cleanly
 * everywhere; an HTML one does not.
 *
 * The sender's name is passed in rather than imported. It keeps these pure
 * functions of their input, which is what lets the wording -- the part that
 * reaches a customer -- be asserted against rendered text instead of inspected
 * in source.
 */

export interface RequestSummary {
  customerName: string | null;
  siteName: string | null;
  addressLine: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  workOrderNumber: string | null;
  accountNumber: string | null;
  scope: string | null;
  siteContactName: string | null;
}

function location(summary: RequestSummary): string | null {
  const area = [summary.city, summary.stateCode].filter(Boolean).join(", ");
  const line = [summary.addressLine, area].filter(Boolean).join(", ");
  return line || null;
}

function heading(summary: RequestSummary): string {
  return summary.siteName ?? summary.customerName ?? "the site";
}

function reference(summary: RequestSummary): string | null {
  const parts = [
    summary.workOrderNumber ? `Job ${summary.workOrderNumber}` : null,
    summary.accountNumber ? `Account ${summary.accountNumber}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * Acknowledgment, sent as a reply on the original request thread.
 *
 * It repeats the scope deliberately. The sender wrote it, but this is the
 * moment a misread is cheapest to correct -- before anyone is dispatched -- and
 * reading it back is how a wrong address or a wrong machine surfaces in an hour
 * instead of on the day.
 *
 * It promises no date. The install is not scheduled until a contractor accepts
 * and picks a window, and a date guessed here is a date somebody plans around.
 */
export function acknowledgmentEmail(
  summary: RequestSummary,
  orgName: string,
): { subject: string; body: string } {
  const ref = reference(summary);
  const where = location(summary);

  const lines = [
    `Thank you -- we have received this installation request${
      summary.siteName || summary.customerName ? ` for ${heading(summary)}` : ""
    }.`,
    "",
  ];

  if (ref) lines.push(ref, "");
  if (where) lines.push(`Site: ${where}`, "");

  if (summary.scope) {
    lines.push(
      "So we are all working from the same understanding, this is what we have:",
      "",
      summary.scope.trim(),
      "",
      "If any of that is wrong, please reply and correct it before we schedule.",
      "",
    );
  }

  lines.push(
    "We are arranging a contractor now. As soon as the installation date and " +
      "arrival window are confirmed, we will send them on this thread.",
    "",
    "One thing we need from you: please let us know when the chemicals are " +
      "due to be delivered to the site. We cannot complete the installation " +
      "without them on hand.",
    "",
    "Reply to this email with any questions.",
    "",
    orgName,
  );

  return {
    subject: `Received: installation request for ${heading(summary)}`,
    body: lines.join("\n"),
  };
}

/**
 * Site readiness, sent separately to the RSM, the sales contact and the site.
 *
 * Separate from the acknowledgment because it asks the site to do things, and a
 * request for photographs buried under a courtesy note gets read as a courtesy
 * note.
 *
 * One version, always the same. The dish machine questions are the expensive
 * ones -- a drain out of reach, the wrong electrical supply, or a flight of
 * stairs turns a finished install into a second trip -- but whether a machine
 * is involved is not reliably legible from the paperwork, and branching on a
 * guess means sometimes not asking. Stating the condition in the text lets the
 * person standing in the kitchen decide, which they can do and a parser
 * cannot.
 */
export function siteReadinessEmail(
  summary: RequestSummary,
  orgName: string,
): { subject: string; body: string } {
  const ref = reference(summary);
  const where = location(summary);

  const lines: string[] = [];

  lines.push(
    summary.siteContactName ? `${summary.siteContactName},` : "Hello,",
    "",
    `${orgName} has been asked to carry out an installation at ${heading(summary)}.`,
    "",
  );

  if (ref) lines.push(ref, "");
  if (where) lines.push(`Site: ${where}`, "");

  if (summary.scope) {
    lines.push("What is being installed:", "", summary.scope.trim(), "");
  }

  lines.push(
    "Before the installer arrives, please make sure the installation area is " +
      "cleared of equipment and wares and has been cleaned. We cannot install " +
      "into an area that is still in use.",
    "",
    "Please also let us know when the chemicals are due to be delivered to the " +
      "site. We cannot complete the installation without them on hand.",
    "",
    // Stated as a condition rather than branched on. Whether a dish machine is
    // involved is not always legible from the paperwork, and a reader who can
    // see the equipment in front of them answers it more reliably than a
    // parser guessing from an abbreviation.
    "If a dish machine is part of this installation, we also need the " +
      "following before we schedule. Please reply with:",
    "",
    "  - whether there is an existing dish machine that needs to be removed",
    "  - a photograph of the overall area where the machine will go",
    "  - a photograph of the drain that will be used",
    "  - a photograph of the electrical supply that will be used",
    "  - whether there are stairs between the delivery entrance and the " +
      "installation area",
    "",
    "Those photographs take a minute and they are the difference between one " +
      "visit and two.",
    "",
    "Reply to this email with anything we should know and we will get the " +
      "installation scheduled.",
    "",
    orgName,
  );

  return {
    subject: `Site information needed before installation - ${heading(summary)}`,
    body: lines.join("\n"),
  };
}

export type DraftEmailKind = "acknowledgment" | "site_readiness";

export interface DraftEmailRow {
  kind: DraftEmailKind;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body: string;
  reply_to_message_id: string | null;
  conversation_id: string | null;
}

/** Where the acknowledgment replies to -- the sender of the original email. */
export interface ReplyThread {
  toEmail: string;
  messageId: string | null;
  conversationId: string | null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * What to draft for one request, from what is actually known about it.
 *
 * An acknowledgment needs a thread to reply into -- only a request that
 * arrived by email has one. A site-readiness note needs at least one real
 * recipient -- only a request with contacts read from an install sheet has
 * those. A request can produce either, both, or neither; nothing here assumes
 * both are always available, and a malformed address is dropped rather than
 * sent.
 */
export function composeDraftEmails(params: {
  summary: RequestSummary;
  orgName: string;
  replyThread?: ReplyThread | null;
  readinessRecipients?: Array<string | null> | null;
}): DraftEmailRow[] {
  const rows: DraftEmailRow[] = [];

  if (params.replyThread && EMAIL_SHAPE.test(params.replyThread.toEmail)) {
    const { subject, body } = acknowledgmentEmail(params.summary, params.orgName);
    rows.push({
      kind: "acknowledgment",
      to_emails: [params.replyThread.toEmail],
      cc_emails: [],
      subject,
      body,
      reply_to_message_id: params.replyThread.messageId,
      conversation_id: params.replyThread.conversationId,
    });
  }

  const readiness = (params.readinessRecipients ?? []).filter(
    (email): email is string => typeof email === "string" && EMAIL_SHAPE.test(email),
  );
  if (readiness.length > 0) {
    const { subject, body } = siteReadinessEmail(params.summary, params.orgName);
    rows.push({
      kind: "site_readiness",
      to_emails: readiness,
      cc_emails: [],
      subject,
      body,
      reply_to_message_id: null,
      conversation_id: null,
    });
  }

  return rows;
}
