"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { parseInstallRequest } from "@/lib/intake/parse";
import {
  type EquipmentItem,
  isSpreadsheetFilename,
  readWorkbook,
} from "@/lib/intake/workbook";
import { createClient } from "@/lib/supabase/server";
import type { Job, PriceListItem } from "@/lib/types";
import { readPricingForm, upsertJobPricing, validatePricing } from "@/lib/pricing-form";
import { fieldErrors, jobFormSchema, readMulti } from "@/lib/validation";

/**
 * Survey workbooks run to several megabytes because of the embedded product
 * photographs. Kept in step with `serverActions.bodySizeLimit` in
 * next.config.ts, which is what actually rejects an oversized upload -- this
 * check exists to say so in words rather than as a framework error.
 */
const MAX_UPLOAD_BYTES = 20 * 1_048_576;

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
  const upload = formData.get("workbook");

  let rawText = typeof pasted === "string" ? pasted.trim() : "";
  let equipment: EquipmentItem[] = [];

  if (upload instanceof File && upload.size > 0) {
    if (!isSpreadsheetFilename(upload.name)) {
      return {
        errors: {
          workbook: `${upload.name} is not a spreadsheet — expected .xlsb, .xlsx, .xlsm, .xls or .csv.`,
        },
      };
    }
    if (upload.size > MAX_UPLOAD_BYTES) {
      const mb = (upload.size / 1_048_576).toFixed(1);
      return {
        errors: {
          workbook: `That file is ${mb} MB; the limit is ${MAX_UPLOAD_BYTES / 1_048_576} MB.`,
        },
      };
    }

    try {
      const read = readWorkbook(await upload.arrayBuffer());
      if (!read.text.trim()) {
        return { errors: { workbook: "That workbook has no readable install sheet." } };
      }
      equipment = read.equipment;
      // The covering email is kept, and kept second. The extractor falls back
      // to scanning the whole document for an address, and a "ship equipment
      // to" line in the email must not outrank the job site on the sheet.
      rawText = rawText ? `${read.text}\n\n--- covering email ---\n${rawText}` : read.text;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "unreadable";
      return { errors: { workbook: `Could not read that workbook: ${detail}` } };
    }
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

  const { data: request, error } = await supabase
    .from("install_requests")
    .insert({
      raw_text: rawText,
      source:
        typeof source === "string" && source
          ? source
          : upload instanceof File && upload.size > 0
            ? "spreadsheet"
            : "paste",
      parsed: { ...parsed, equipment } as unknown as Record<string, unknown>,
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
    contractor_pay: formData.get("contractor_pay") || "0",
    scheduled_start: formData.get("scheduled_start") ?? "",
    scheduled_end: formData.get("scheduled_end") ?? "",
    deadline_at: formData.get("deadline_at") ?? "",
    skill_ids: readMulti(formData, "skill_ids"),
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const pricing = readPricingForm(formData);
  const pricingErrors = validatePricing(pricing);
  if (pricingErrors) return { errors: pricingErrors };

  const { skill_ids, contractor_pay: _ignored, ...fields } = parsed.data;
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
