"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ORG_NAME } from "@/lib/branding";
import {
  payloadFromStored,
  summaryFromParsedRequest,
  toParsedRequest,
} from "@/lib/automation/to-parsed";
import { requireAdmin } from "@/lib/auth";
import { composeDraftEmails } from "@/lib/email/install-templates";
import { type ParsedRequest, parseInstallRequest } from "@/lib/intake/parse";
import { sheetInstructions, sheetScope, sheetTitle } from "@/lib/intake/summary";
import {
  readinessRecipients,
  type InstallContacts,
  type SheetDetails,
  type SheetItem,
  type SheetSection,
} from "@/lib/intake/workbook";
import { createClient } from "@/lib/supabase/server";
import type { Job, PriceListItem } from "@/lib/types";
import { readPricingForm, upsertJobPricing, validatePricing } from "@/lib/pricing-form";
import { fieldErrors, jobFormSchema, readMulti } from "@/lib/validation";

/** Matches the reader's own cap; anything larger did not come from a sheet. */
const MAX_SHEET_CHARS = 80_000;

/**
 * What the sheet asked for, as the browser extracted it.
 *
 * The workbook is read client-side -- Vercel caps every request at 4.5 MB and
 * these files are larger -- so this arrives as JSON from the page rather than
 * from a file the server read itself. It is shaped and bounded here rather than
 * stored as received: it becomes a job's scope and site instructions, which a
 * contractor is then sent.
 */
const SECTIONS: SheetSection[] = ["install", "dispenser_equipment", "chemicals"];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The contact block, if the sheet had one.
 *
 * This is who the site-readiness email goes to, so every field is bounded and
 * every address is shape-checked the same as the rest of this form -- nothing
 * the browser sends is trusted further than that.
 */
function readContactsField(source: Record<string, unknown>): InstallContacts | null {
  const raw = source.contacts;
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;

  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.slice(0, max).trim();
    return trimmed || null;
  };
  const email = (v: unknown): string | null => {
    const s = str(v, 200);
    return s && EMAIL_SHAPE.test(s) ? s : null;
  };
  const machineModels = (Array.isArray(c.machineModels) ? c.machineModels : [])
    .filter((m): m is string => typeof m === "string")
    .slice(0, 20)
    .map((m) => m.slice(0, 200));

  const contacts: InstallContacts = {
    accountName: str(c.accountName, 200),
    accountNumber: str(c.accountNumber, 60),
    streetAddress: str(c.streetAddress, 300),
    city: str(c.city, 120),
    stateCode: str(c.stateCode, 10),
    postalCode: str(c.postalCode, 20),
    customerName: str(c.customerName, 200),
    customerPhone: str(c.customerPhone, 60),
    customerEmail: email(c.customerEmail),
    salesRepName: str(c.salesRepName, 200),
    salesRepPhone: str(c.salesRepPhone, 60),
    salesRepEmail: email(c.salesRepEmail),
    ssdcRepName: str(c.ssdcRepName, 200),
    specialistName: str(c.specialistName, 200),
    specialistEmail: email(c.specialistEmail),
    operatingCompany: str(c.operatingCompany, 200),
    machineModels,
  };

  const hasAnything = Object.values(contacts).some((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  );
  return hasAnything ? contacts : null;
}

function readDetailsField(raw: FormDataEntryValue | null): SheetDetails {
  const empty: SheetDetails = { items: [], notes: [], customerEmail: null, contacts: null };
  if (typeof raw !== "string" || !raw.trim()) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;

  const source = parsed as { items?: unknown; notes?: unknown };
  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.slice(0, max) : "";

  const items = (Array.isArray(source.items) ? source.items : [])
    .slice(0, 300)
    .flatMap((row): SheetItem[] => {
      if (typeof row !== "object" || row === null) return [];
      const item = row as Record<string, unknown>;
      const description = str(item.description, 200);
      if (!description) return [];

      const section = SECTIONS.find((s) => s === item.section) ?? "install";
      const quantity =
        typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
          ? Math.min(Math.round(item.quantity), 9999)
          : null;

      return [
        {
          section,
          category: str(item.category, 120),
          code: str(item.code, 40) || null,
          description,
          quantity,
        },
      ];
    });

  const notes = (Array.isArray(source.notes) ? source.notes : [])
    .slice(0, 30)
    .map((n) => str(n, 1000))
    .filter(Boolean);

  const email = str((source as { customerEmail?: unknown }).customerEmail, 200);
  return {
    items,
    notes,
    customerEmail: EMAIL_SHAPE.test(email) ? email : null,
    contacts: readContactsField(source as Record<string, unknown>),
  };
}

export interface RequestState {
  error?: string;
  errors?: Record<string, string>;
  success?: string;
}

/**
 * Take in a raw install request and extract what can be recognised.
 *
 * The raw text is stored verbatim alongside the extraction, so a job can always
 * be traced back to exactly what was asked for.
 */
export async function createRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const admin = await requireAdmin();

  const pasted = formData.get("raw_text");
  const source = formData.get("source");
  const sheetText = formData.get("sheet_text");

  let rawText = typeof pasted === "string" ? pasted.trim() : "";
  let details: SheetDetails = { items: [], notes: [], customerEmail: null, contacts: null };

  if (typeof sheetText === "string" && sheetText.trim()) {
    if (sheetText.length > MAX_SHEET_CHARS) {
      return {
        errors: {
          sheet_text: "That sheet is far larger than an install request should be.",
        },
      };
    }
    details = readDetailsField(formData.get("details"));
    // The covering email is kept, and kept second. The extractor falls back
    // to scanning the whole document for an address, and a "ship equipment
    // to" line in the email must not outrank the job site on the sheet.
    rawText = rawText ? `${sheetText}\n\n--- covering email ---\n${rawText}` : sheetText.trim();
  }

  if (rawText.length < 10) {
    return { errors: { raw_text: "Attach the install sheet, or paste the request text." } };
  }

  const supabase = await createClient();

  const { data: priceList } = await supabase
    .from("price_list_items")
    .select("code, name")
    .eq("is_active", true);

  const parsed = parseInstallRequest(
    rawText,
    (priceList ?? []) as Array<{ code: string; name: string }>,
  );

  // A form is not a description of work. When the request came from a sheet,
  // the title and scope are written from the fields that were identified rather
  // than lifted out of the grid, which would otherwise put several hundred
  // lines of sales fields in front of a contractor.
  const fromSheet = typeof sheetText === "string" && Boolean(sheetText.trim());
  const summarised: ParsedRequest = fromSheet
    ? {
        ...parsed,
        title: { value: sheetTitle(parsed), evidence: "composed from the sheet", basis: "label" },
        scope: sheetScope(parsed, details),
      }
    : parsed;

  const { data: request, error } = await supabase
    .from("install_requests")
    .insert({
      raw_text: rawText,
      source: typeof source === "string" && source ? source : "paste",
      parsed: { ...summarised, details } as unknown as Record<string, unknown>,
      created_by: admin.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !request) {
    return { error: error?.message ?? "Could not save the request." };
  }

  // Drafted, not sent -- an administrator releases it from the review screen.
  // Only a sheet with contacts produces one: there is no thread to reply into
  // on a hand-uploaded request, so the acknowledgment does not apply here.
  if (details.contacts) {
    try {
      let rsmEmail: string | null = null;
      if (details.contacts.ssdcRepName) {
        const { data: rsm } = await supabase
          .from("rsm_contacts")
          .select("email")
          .ilike("name", details.contacts.ssdcRepName)
          .maybeSingle<{ email: string | null }>();
        rsmEmail = rsm?.email ?? null;
      }

      const rows = composeDraftEmails({
        summary: summaryFromParsedRequest(summarised, details.contacts),
        orgName: ORG_NAME,
        readinessRecipients: readinessRecipients(details.contacts, rsmEmail),
      });

      if (rows.length > 0) {
        await supabase
          .from("outbound_emails")
          .insert(rows.map((row) => ({ ...row, request_id: request.id })));
      }
    } catch (cause) {
      console.error("createRequest: draft compose failed", cause);
    }
  }

  revalidatePath("/admin/requests");
  redirect(`/admin/requests/${request.id}`);
}

/**
 * Turn a reviewed request into a job.
 *
 * The administrator has corrected the extraction by this point; what is saved
 * is what they confirmed, never the raw parse.
 */
export async function convertRequestToJob(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const admin = await requireAdmin();

  const requestId = formData.get("request_id");
  if (typeof requestId !== "string") return { error: "Missing request." };

  const parsed = jobFormSchema.safeParse({
    title: formData.get("title") ?? "",
    customer_name: formData.get("customer_name") ?? "",
    site_name: formData.get("site_name") ?? "",
    address_line1: formData.get("address_line1") ?? "",
    address_line2: formData.get("address_line2") ?? "",
    city: formData.get("city") ?? "",
    state_code: formData.get("state_code") ?? "",
    postal_code: formData.get("postal_code") ?? "",
    scope: formData.get("scope") ?? "",
    instructions: formData.get("instructions") ?? "",
    scheduled_start: formData.get("scheduled_start") ?? "",
    scheduled_end: formData.get("scheduled_end") ?? "",
    deadline_at: formData.get("deadline_at") ?? "",
    skill_ids: readMulti(formData, "skill_ids"),
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const pricing = readPricingForm(formData);
  const pricingErrors = validatePricing(pricing);
  if (pricingErrors) return { errors: pricingErrors };

  const { skill_ids, ...fields } = parsed.data;
  const supabase = await createClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      ...pricing.jobFields,
      site_contact_name: (formData.get("site_contact_name") as string)?.trim() || null,
      site_contact_phone: (formData.get("site_contact_phone") as string)?.trim() || null,
      access_notes: (formData.get("access_notes") as string)?.trim() || null,
      customer_reference: (formData.get("customer_reference") as string)?.trim() || null,
      status: "ready",
      created_by: admin.id,
    })
    .select("id")
    .single<Pick<Job, "id">>();

  if (error || !job) return { error: error?.message ?? "Could not create the job." };

  const { error: pricingError } = await upsertJobPricing(supabase, job.id, pricing, admin.id);
  if (pricingError) return { error: pricingError };

  if (skill_ids.length > 0) {
    await supabase
      .from("job_skills")
      .insert(skill_ids.map((skill_id) => ({ job_id: job.id, skill_id })));
  }

  await supabase
    .from("install_requests")
    .update({
      status: "converted",
      job_id: job.id,
      converted_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  revalidatePath("/admin/requests");
  redirect(`/admin/jobs/${job.id}`);
}

export async function discardRequest(formData: FormData): Promise<void> {
  await requireAdmin();
  const requestId = formData.get("request_id");
  const reason = formData.get("reason");
  if (typeof requestId !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("install_requests")
    .update({
      status: "discarded",
      discard_reason: typeof reason === "string" ? reason : null,
    })
    .eq("id", requestId);

  revalidatePath("/admin/requests");
  redirect("/admin/requests");
}

/** Re-run extraction, for after the price list or the parser has changed. */
export async function reparseRequest(formData: FormData): Promise<void> {
  await requireAdmin();
  const requestId = formData.get("request_id");
  if (typeof requestId !== "string") return;

  const supabase = await createClient();

  const [{ data: request }, { data: priceList }] = await Promise.all([
    supabase
      .from("install_requests")
      .select("raw_text, source, parsed")
      .eq("id", requestId)
      .maybeSingle<{
        raw_text: string;
        source: string;
        parsed: Record<string, unknown> | null;
      }>(),
    supabase.from("price_list_items").select("code, name").eq("is_active", true),
  ]);

  if (!request) return;

  // An emailed request was already read by the workflow, which knows mHelp's
  // labels. The generic text parser does not, so re-running it here would
  // replace a good extraction with a worse one. Rebuild from what the
  // automation sent while that is still recoverable, and fall back to reading
  // the text only when it is not.
  const recovered =
    request.source === "automation" ? payloadFromStored(request.parsed) : null;

  const parsed = recovered
    ? toParsedRequest(recovered)
    : parseInstallRequest(
        request.raw_text,
        (priceList ?? []) as Array<Pick<PriceListItem, "code" | "name">>,
      );

  await supabase
    .from("install_requests")
    .update({ parsed: parsed as unknown as Record<string, unknown> })
    .eq("id", requestId);

  revalidatePath(`/admin/requests/${requestId}`);
}

/**
 * Release a drafted email to send.
 *
 * This does not send it. It moves the row from 'draft' to 'queued', which is
 * as far as this application goes -- n8n sends through the real Outlook
 * mailbox, and picks up whatever is queued on its own schedule. The `eq`
 * status guard is what makes clicking twice harmless.
 */
export async function releaseOutboundEmail(formData: FormData): Promise<void> {
  await requireAdmin();
  const emailId = formData.get("email_id");
  const requestId = formData.get("request_id");
  if (typeof emailId !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("outbound_emails")
    .update({ status: "queued" })
    .eq("id", emailId)
    .eq("status", "draft");

  if (typeof requestId === "string") revalidatePath(`/admin/requests/${requestId}`);
}

/** Call off a draft or a released email before it sends. */
export async function cancelOutboundEmail(formData: FormData): Promise<void> {
  await requireAdmin();
  const emailId = formData.get("email_id");
  const requestId = formData.get("request_id");
  if (typeof emailId !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("outbound_emails")
    .update({ status: "cancelled" })
    .eq("id", emailId)
    .in("status", ["draft", "queued"]);

  if (typeof requestId === "string") revalidatePath(`/admin/requests/${requestId}`);
}
