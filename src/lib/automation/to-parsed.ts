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
