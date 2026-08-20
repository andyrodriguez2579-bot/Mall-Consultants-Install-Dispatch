import { z } from "zod";

/**
 * The payload n8n sends for one installation email.
 *
 * Every business field is optional on purpose. The extraction step is an AI
 * reading someone's email, and the instruction it is given is to leave a field
 * blank rather than invent it -- so a schema that rejected an incomplete
 * payload would throw away exactly the requests that most need a human to look
 * at them. What is required is only what identifies the email itself.
 *
 * Unknown keys are stripped rather than rejected, so adding a field to the n8n
 * workflow cannot start failing every request before the application is
 * redeployed.
 */
export const installRequestPayload = z.object({
  // Identity of the source email. The message id is the duplicate guard, and
  // the only field the caller genuinely must get right.
  source_email_message_id: z.string().trim().min(1).max(998),
  source_email_conversation_id: z.string().trim().max(998).optional(),
  source_email_subject: z.string().trim().max(998).optional(),
  source_email_sender: z.string().trim().max(320).optional(),
  source_email_received_at: z.string().trim().optional(),

  /** The email itself, kept verbatim as the record of what was asked for. */
  raw_text: z.string().min(1, "The email body is required."),

  prime_contractor: z.string().trim().max(160).optional(),
  operating_company: z.string().trim().max(160).optional(),
  rsm_name: z.string().trim().max(160).optional(),

  customer_name: z.string().trim().max(200).optional(),
  site_name: z.string().trim().max(200).optional(),
  installation_address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(20).optional(),

  site_contact_name: z.string().trim().max(160).optional(),
  site_contact_email: z.string().trim().max(320).optional(),
  site_contact_phone: z.string().trim().max(40).optional(),

  equipment_type: z.string().trim().max(200).optional(),
  equipment_model: z.string().trim().max(200).optional(),

  work_order_number: z.string().trim().max(120).optional(),
  po_number: z.string().trim().max(120).optional(),
  account_number: z.string().trim().max(120).optional(),

  requested_completion_date: z.string().trim().max(40).optional(),
  required_by_date: z.string().trim().max(40).optional(),

  installation_notes: z.string().max(20_000).optional(),

  /**
   * Fields the extraction could not find. Sent by the workflow rather than
   * inferred here, because the extractor is the only thing that knows the
   * difference between "the email did not say" and "the email said nothing I
   * recognised".
   */
  missing_fields: z.array(z.string().max(80)).max(60).optional(),

  /** Set by the workflow when it wants a person to look before anything moves. */
  needs_review: z.boolean().optional(),
  review_reason: z.string().trim().max(500).optional(),
});

export type InstallRequestPayload = z.infer<typeof installRequestPayload>;

/**
 * A date that may arrive as anything an email contained.
 *
 * Returns null rather than today for anything unrecognisable: a wrong date on a
 * work order sends somebody to a site on the wrong day, which is worse than a
 * blank an administrator has to fill in.
 */
export function parseDateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function parseTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Decide whether a request can proceed without a person.
 *
 * The bar is what it takes to dispatch: somewhere to go and something to do.
 * Anything short of that becomes a review item rather than a guess, because a
 * contractor sent to an address the parser invented is a real trip to a real
 * place that was never asked for.
 */
export function reviewVerdict(payload: InstallRequestPayload): {
  needsReview: boolean;
  reason: string | null;
} {
  if (payload.needs_review) {
    return {
      needsReview: true,
      reason: payload.review_reason ?? "The automation asked for a review.",
    };
  }

  const missing: string[] = [];
  if (!payload.customer_name && !payload.site_name) missing.push("customer or site name");
  if (!payload.installation_address) missing.push("installation address");
  if (!payload.city) missing.push("city");
  if (!payload.state) missing.push("state");

  if (missing.length > 0) {
    return {
      needsReview: true,
      reason: `Could not read: ${missing.join(", ")}.`,
    };
  }

  return { needsReview: false, reason: null };
}
