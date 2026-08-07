import { z } from "zod";
import { parseMoneyToCents } from "./format";

/**
 * Input validation.
 *
 * These schemas mirror the CHECK constraints in the migrations on purpose.
 * The database is the real enforcement point; validating here as well is what
 * turns a constraint violation into a sentence a person can act on.
 */

/**
 * Normalise a typed phone number to E.164.
 * Accepts "(713) 555-0201", "713-555-0201", "+1 713 555 0201".
 * Bare 10-digit input is assumed to be US/Canada, matching the operating region.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hasPlus) {
    return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const phoneSchema = z
  .string()
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return z.NEVER;
    }
    return normalized;
  });

export const moneySchema = z.string().transform((v, ctx) => {
  const cents = parseMoneyToCents(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 850 or 1,250.00." });
    return z.NEVER;
  }
  if (cents <= 0) {
    ctx.addIssue({ code: "custom", message: "Contractor pay must be greater than zero." });
    return z.NEVER;
  }
  if (cents > 100_000_00) {
    ctx.addIssue({ code: "custom", message: "That is above the $100,000 per-job ceiling." });
    return z.NEVER;
  }
  return cents;
});

/** Optional datetime-local field: empty string means "not set". */
const optionalDateTime = z
  .string()
  .optional()
  .transform((v) => {
    if (!v || v.trim() === "") return null;
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  });

export const jobFormSchema = z
  .object({
    title: z.string().trim().min(3, "Give the job a short title.").max(160),
    customer_name: z.string().trim().min(2, "Who is the customer?").max(160),
    site_name: z.string().trim().max(160).optional().transform((v) => v || null),
    address_line1: z.string().trim().min(3, "Street address is required."),
    address_line2: z.string().trim().optional().transform((v) => v || null),
    city: z.string().trim().min(2, "City is required."),
    state_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use the two-letter state code."),
    postal_code: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit or ZIP+4 postal code."),
    scope: z.string().trim().min(10, "Describe the scope of work in a sentence or two."),
    instructions: z.string().trim().optional().transform((v) => v || null),
    contractor_pay: moneySchema,
    scheduled_start: optionalDateTime,
    scheduled_end: optionalDateTime,
    deadline_at: optionalDateTime,
    skill_ids: z.array(z.string().uuid()).default([]),
  })
  .refine(
    (v) =>
      !v.scheduled_start ||
      !v.scheduled_end ||
      new Date(v.scheduled_end) >= new Date(v.scheduled_start),
    { message: "The end time cannot be before the start time.", path: ["scheduled_end"] },
  );

export type JobFormValues = z.infer<typeof jobFormSchema>;

export const dispatchSchema = z.object({
  job_id: z.string().uuid(),
  contractor_ids: z
    .array(z.string().uuid())
    .min(1, "Select at least one contractor."),
  expires_in_hours: z.coerce
    .number()
    .min(0.5, "Give contractors at least 30 minutes.")
    .max(168, "An offer window longer than a week is not useful."),
});

export const completionSchema = z.object({
  job_id: z.string().uuid(),
  notes: z
    .string()
    .trim()
    .min(10, "Describe what you did, in a sentence or two."),
  // Proof of work lives in the field ticket application; this is the reference
  // that ties the two records together.
  field_ticket_ref: z
    .string()
    .trim()
    .min(2, "Enter the field ticket number from the ticket app.")
    .max(60),
});

export const reworkSchema = z.object({
  job_id: z.string().uuid(),
  notes: z.string().trim().min(10, "Explain what needs to be corrected."),
});

export const paymentSchema = z.object({
  job_id: z.string().uuid(),
  reference: z.string().trim().min(1, "Record a payment reference."),
  method: z.string().trim().optional().transform((v) => v || null),
});

export const contractorFormSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required.").max(120),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email address."),
  company_name: z.string().trim().optional().transform((v) => v || null),
  max_travel_miles: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }),
  skill_ids: z.array(z.string().uuid()).default([]),
  service_area_ids: z.array(z.string().uuid()).default([]),
});

export const questionSchema = z.object({
  token: z.string().min(10),
  question: z
    .string()
    .trim()
    .min(5, "What would you like to ask?")
    .max(1000, "Keep the question under 1000 characters."),
});

/** Collapse a ZodError into a field -> message map for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}

/** Read repeated form fields (checkbox groups) as a string array. */
export function readMulti(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");
}
