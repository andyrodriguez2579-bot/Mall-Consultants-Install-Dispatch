"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { parseInstallRequest } from "@/lib/intake/parse";
import { createClient } from "@/lib/supabase/server";
import type { Job, PriceListItem } from "@/lib/types";
import { lineItemsTotal, readLineItems, readWorkOrderFields } from "@/lib/line-items";
import { fieldErrors, jobFormSchema, readMulti } from "@/lib/validation";

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

  const rawText = formData.get("raw_text");
  const source = formData.get("source");

  if (typeof rawText !== "string" || rawText.trim().length < 10) {
    return { errors: { raw_text: "Paste the request text first." } };
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
      source: typeof source === "string" && source ? source : "paste",
      parsed: parsed as unknown as Record<string, unknown>,
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

  const lineItems = readLineItems(formData);
  const usesLineItems = lineItems.length > 0;

  if (!usesLineItems && parsed.data.contractor_pay <= 0) {
    return {
      errors: {
        contractor_pay:
          "Add priced work items, or set a contractor payment for this job.",
      },
    };
  }

  const { skill_ids, contractor_pay, ...fields } = parsed.data;
  const supabase = await createClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      // Line items are the source of truth when present; the trigger recomputes
      // the total from them the moment they are inserted below.
      contractor_pay_cents: usesLineItems ? lineItemsTotal(lineItems) : contractor_pay,
      pay_source: usesLineItems ? "line_items" : "manual",
      ...readWorkOrderFields(formData),
      status: "ready",
      created_by: admin.id,
    })
    .select("id")
    .single<Pick<Job, "id">>();

  if (error || !job) return { error: error?.message ?? "Could not create the job." };

  if (usesLineItems) {
    const { error: lineError } = await supabase
      .from("job_line_items")
      .insert(lineItems.map((li) => ({ ...li, job_id: job.id })));
    if (lineError) return { error: lineError.message };
  }

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
