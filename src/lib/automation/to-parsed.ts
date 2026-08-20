import type { ParsedRequest } from "@/lib/intake/parse";
import type { InstallRequestPayload } from "./install-request";

/**
 * Turn the automation payload into the shape the review screen reads.
 *
 * The review screen was built for the paste-and-extract path and reads a
 * ParsedRequest: every field an object carrying the value, the text it came
 * from, and whether it was labelled or merely inferred. The automation endpoint
 * first stored its own flat shape with its own names -- installation_address
 * where the screen looks for address_line1 -- so a request arrived with every
 * field correctly extracted and every box on screen empty, marked "not found".
 *
 * Mapping here rather than changing the review screen keeps one reader and one
 * format: an install sheet pasted by hand and an email read by n8n arrive
 * looking the same, and there is one place to correct them.
 */

/** Every value here came from a labelled line, which is what mHelp emails are. */
const labelled = (value: string | null | undefined, evidence: string) =>
  value ? { value, evidence, basis: "label" as const } : null;

/**
 * A job title, since no email carries one.
 *
 * Composed rather than extracted, and marked as inferred for that reason -- the
 * review screen distinguishes "the request said this" from "we worked it out",
 * and a title nobody wrote deserves the second label.
 */
function inferTitle(payload: InstallRequestPayload) {
  const who = payload.site_name ?? payload.customer_name;
  if (!who) return null;

  // "Luigi's Pizza - 509103264" reads better on a work order without the
  // account number repeated, which has its own field.
  const name = who.replace(/\s*[-–]\s*\d{4,}\s*$/, "").trim() || who;
  const where = payload.city;

  return {
    value: where ? `SSDC installation - ${name}, ${where}` : `SSDC installation - ${name}`,
    evidence: who,
    basis: "pattern" as const,
  };
}

/**
 * The scope a contractor reads.
 *
 * mHelp puts the instruction in Description and follows it with housekeeping
 * aimed at the installer's own back office -- uploading photos into mHelp,
 * marking the ticket complete. That is not work at the site, and it means
 * nothing to a Mall Consultants contractor, so it is dropped.
 */
function buildScope(payload: InstallRequestPayload): string {
  const notes = (payload.installation_notes ?? "").trim();
  if (!notes) return "";

  const trimmed = notes
    .replace(/\s*Upon completion,[\s\S]*$/i, "")
    .replace(/\s*Upload photos[\s\S]*$/i, "")
    .trim();

  return trimmed || notes;
}

/**
 * Recover the automation's own extraction from a stored request.
 *
 * Two shapes exist in the wild. Requests written before the review screen's
 * format was matched hold flat keys at the top level; later ones keep them
 * under `automation` beside the ParsedRequest. Reading both means "re-run
 * extraction" repairs the early ones instead of falling back to the generic
 * text parser, which knows nothing about mHelp's labels and would do a worse
 * job than the workflow already did.
 *
 * Returns null when there is nothing of the sort to recover, which is the
 * signal to use the text parser after all.
 */
export function payloadFromStored(
  stored: Record<string, unknown> | null | undefined,
): InstallRequestPayload | null {
  if (!stored) return null;

  const nested = stored.automation as Record<string, unknown> | undefined;
  const str = (key: string): string | null => {
    const value = nested?.[key] ?? stored[key];
    return typeof value === "string" && value.trim() ? value : null;
  };

  // The address is the tell: a ParsedRequest holds address_line1 as an object,
  // while the automation's own shape holds installation_address as a string.
  const address = str("installation_address");
  const customer = str("customer_name");
  if (!address && !customer) return null;

  return {
    source_email_message_id: "recovered",
    raw_text: "recovered",
    customer_name: customer,
    site_name: str("site_name"),
    installation_address: address,
    city: str("city"),
    state: str("state"),
    zip: str("zip"),
    site_contact_name: str("site_contact_name"),
    site_contact_email: str("site_contact_email"),
    site_contact_phone: str("site_contact_phone"),
    work_order_number: str("work_order_number"),
    po_number: str("po_number"),
    account_number: str("account_number"),
    installation_notes: str("installation_notes"),
    equipment_type: str("equipment_type"),
    equipment_model: str("equipment_model"),
    prime_contractor: str("prime_contractor"),
    operating_company: str("operating_company"),
    rsm_name: str("rsm_name"),
    required_by_date: str("required_by_date"),
    requested_completion_date: str("requested_completion_date"),
  } as InstallRequestPayload;
}

/** The job form's own requirements, worded as the review screen words them. */
const REQUIRED: Array<[keyof ParsedRequest, string]> = [
  ["customer_name", "Customer"],
  ["address_line1", "Street address"],
  ["city", "City"],
  ["state_code", "State"],
  ["postal_code", "ZIP"],
];

export function toParsedRequest(payload: InstallRequestPayload): ParsedRequest {
  const result: ParsedRequest = {
    title: inferTitle(payload),
    customer_name: labelled(payload.customer_name, "Account Name"),
    site_name: labelled(payload.site_name, "Customer Name"),
    address_line1: labelled(payload.installation_address, "Address"),
    city: labelled(payload.city, "Address"),
    state_code: labelled(payload.state?.toUpperCase(), "Address"),
    postal_code: labelled(payload.zip, "Address"),
    site_contact_name: labelled(payload.site_contact_name, "Site contact"),
    site_contact_phone: labelled(payload.site_contact_phone, "Site contact"),
    // mHelp's Job ID is the number every later conversation quotes, so it is
    // what belongs in the reference the contractor and the invoice both carry.
    customer_reference: labelled(
      payload.work_order_number ?? payload.po_number,
      payload.work_order_number ? "Job ID" : "PO number",
    ),
    scheduled_start: null,
    deadline_at: labelled(payload.required_by_date, "Required by"),
    scope: buildScope(payload),
    suggestedItems: [],
    missing: [],
  };

  // Computed here rather than trusted from the caller: the review screen
  // highlights these, and what the job form requires is this application's
  // business, not the workflow's.
  result.missing = REQUIRED.filter(([key]) => result[key] === null).map(
    ([, label]) => label,
  );

  return result;
}
