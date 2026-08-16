"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { type ParsedRequest, parseInstallRequest } from "@/lib/intake/parse";
import { sheetInstructions, sheetScope, sheetTitle } from "@/lib/intake/summary";
import type { SheetDetails, SheetItem, SheetSection } from "@/lib/intake/workbook";
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

function readDetailsField(raw: FormDataEntryValue | null): SheetDetails {
  const empty: SheetDetails = { items: [], notes: [], customerEmail: null };
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
  return { items, notes, customerEmail: EMAIL_SHAPE.test(email) ? email : null };
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
  let details: SheetDetails = { items: [], notes: [], customerEmail: null };

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
    supabase.from("install_requests").select("raw_text").eq("id", requestId).maybeSingle<{
      raw_text: string;
    }>(),
    supabase.from("price_list_items").select("code, name").eq("is_active", true),
  ]);

  if (!request) return;

  const parsed = parseInstallRequest(
    request.raw_text,
    (priceList ?? []) as Array<Pick<PriceListItem, "code" | "name">>,
  );

  await supabase
    .from("install_requests")
    .update({ parsed: parsed as unknown as Record<string, unknown> })
    .eq("id", requestId);

  revalidatePath(`/admin/requests/${requestId}`);
}
