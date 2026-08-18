"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { SMS_CONSENT_TEXT } from "@/lib/consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, phoneSchema } from "@/lib/validation";

export interface ApplyState {
  error?: string;
  errors?: Record<string, string>;
  submitted?: boolean;
}

const applicationSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name.").max(120),
  company_name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email address."),
  city: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  state_code: z
    .string()
    .trim()
    .max(2)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  max_travel_miles: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || !v.trim()) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }),
  experience: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
});

/** Applications an hour from one address before we stop listening. */
const IP_LIMIT = 5;

/**
 * Receive an application.
 *
 * Writes a row and nothing else. No auth user, no profile, no contractor: the
 * public surface is deliberately incapable of minting a login, so the worst an
 * abusive submission achieves is a row an administrator deletes. Approval is
 * what creates an account, and that is an administrator's action.
 *
 * The service-role client is used because the table has no policy for anon --
 * it holds private mobile numbers and email addresses, and the people most
 * likely to go looking for it are the ones it must not serve.
 */
export async function submitApplication(
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const parsed = applicationSchema.safeParse({
    full_name: formData.get("full_name") ?? "",
    company_name: formData.get("company_name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    city: formData.get("city") ?? "",
    state_code: formData.get("state_code") ?? "",
    max_travel_miles: formData.get("max_travel_miles") ?? "",
    experience: formData.get("experience") ?? "",
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  if (formData.get("accepted_terms") !== "on") {
    return { errors: { accepted_terms: "Please accept the terms to apply." } };
  }

  const smsOptIn = formData.get("sms_opt_in") === "on";
  const admin = createAdminClient();

  const headerList = await headers();
  // Left-most entry is the client; the rest were added by proxies in front.
  const sourceIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerList.get("user-agent")?.slice(0, 500) ?? null;

  if (sourceIp) {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await admin
      .from("contractor_applications")
      .select("id", { count: "exact", head: true })
      .eq("source_ip", sourceIp)
      .gte("created_at", since);

    if ((count ?? 0) >= IP_LIMIT) {
      return {
        error:
          "We have received several applications from this connection already. " +
          "Please try again later, or call us.",
      };
    }
  }

  const { error } = await admin.from("contractor_applications").insert({
    ...parsed.data,
    sms_opt_in: smsOptIn,
    // Stored verbatim, so what someone agreed to survives edits to this page.
    consent_text: smsOptIn ? SMS_CONSENT_TEXT : null,
    consented_at: smsOptIn ? new Date().toISOString() : null,
    accepted_terms: true,
    source_ip: sourceIp,
    user_agent: userAgent,
  });

  if (error) {
    // The partial unique index on pending applications is the expected clash,
    // and re-applying is not an error worth alarming anyone about.
    if (/duplicate key|unique/i.test(error.message)) {
      return { submitted: true };
    }

    // Logged in full, because the applicant is told something calm and general
    // and would otherwise be the only person who knew anything had gone wrong.
    // This is the line to search for in the platform logs.
    console.error("submitApplication: insert failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    // A missing table is a setup step, not a fault of theirs, and telling them
    // to "try again" would have them retry something that cannot yet succeed.
    // PostgREST reports it as PGRST205; Postgres as 42P01.
    const notSetUp =
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      /could not find the table|does not exist/i.test(error.message);

    if (notSetUp) {
      return {
        error:
          "This form is not quite finished being set up on our side. Nothing " +
          "you did is wrong -- please call us and we will take your details.",
      };
    }

    return { error: "We could not submit your application. Please try again." };
  }

  return { submitted: true };
}
