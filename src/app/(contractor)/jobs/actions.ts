"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedContractor } from "@/lib/auth";
import { notifyAcceptance } from "@/lib/dispatch";
import { createClient } from "@/lib/supabase/server";
import type { AcceptResult, Job, OfferActionResult } from "@/lib/types";
import { completionSchema, fieldErrors } from "@/lib/validation";

export interface WorkState {
  error?: string;
  errors?: Record<string, string>;
  success?: string;
  result?: AcceptResult;
  message?: string;
}

/**
 * Accept an offer from inside the app.
 *
 * Routes to accept_job_offer_by_id, which shares its entire body with the
 * SMS-link path, so the "exactly one winner" guarantee is identical whichever
 * way the contractor arrived.
 */
export async function acceptOfferById(
  _prev: WorkState,
  formData: FormData,
): Promise<WorkState> {
  const user = await requireApprovedContractor();
  const offerId = formData.get("offer_id");
  if (typeof offerId !== "string") return { error: "Missing offer." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_job_offer_by_id", {
    p_offer_id: offerId,
  });

  if (error) return { error: "We could not process that just now. Please try again." };

  const outcome = (Array.isArray(data) ? data[0] : data) as OfferActionResult | undefined;
  if (!outcome) return { error: "We could not process that just now. Please try again." };

  if (outcome.result === "accepted" && outcome.job_id) {
    await notifyAcceptance({ jobId: outcome.job_id, winnerContractorId: user.id });
  }

  revalidatePath("/jobs");
  return { result: outcome.result, message: outcome.message };
}

export async function passOfferById(
  _prev: WorkState,
  formData: FormData,
): Promise<WorkState> {
  await requireApprovedContractor();
  const offerId = formData.get("offer_id");
  if (typeof offerId !== "string") return { error: "Missing offer." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pass_job_offer_by_id", {
    p_offer_id: offerId,
  });

  if (error) return { error: "We could not record that. Please try again." };

  const outcome = (Array.isArray(data) ? data[0] : data) as OfferActionResult | undefined;
  revalidatePath("/jobs");
  return { result: outcome?.result, message: outcome?.message };
}

export async function confirmArrival(formData: FormData): Promise<void> {
  const user = await requireApprovedContractor();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();
  await supabase.rpc("contractor_confirm_arrival", {
    p_job_id: jobId,
    p_contractor_id: user.id,
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function startWork(formData: FormData): Promise<void> {
  const user = await requireApprovedContractor();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();
  await supabase.rpc("contractor_start_work", {
    p_job_id: jobId,
    p_contractor_id: user.id,
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Record a photo that the browser has already uploaded to storage.
 *
 * Files go from the device straight to Supabase Storage under the contractor's
 * own session, so the bytes never pass through a server action -- which would
 * cap them at the body limit and burn function time on a mobile connection.
 * Storage RLS authorises the write; this only records the metadata.
 */
export async function recordPhoto(formData: FormData): Promise<void> {
  const user = await requireApprovedContractor();

  const jobId = formData.get("job_id");
  const filePath = formData.get("file_path");
  const kind = formData.get("kind");
  const fileName = formData.get("file_name");
  const contentType = formData.get("content_type");
  const sizeBytes = formData.get("size_bytes");

  if (
    typeof jobId !== "string" ||
    typeof filePath !== "string" ||
    (kind !== "before" && kind !== "after")
  ) {
    return;
  }

  // The path must sit under this job's folder -- that is what storage RLS keys
  // on, and it stops a crafted path from attaching a file to another job.
  if (!filePath.startsWith(`${jobId}/`)) return;

  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, assigned_contractor_id, status")
    .eq("id", jobId)
    .maybeSingle<Pick<Job, "id" | "assigned_contractor_id" | "status">>();

  if (!job || job.assigned_contractor_id !== user.id) return;

  await supabase.from("job_attachments").insert({
    job_id: jobId,
    kind,
    file_path: filePath,
    file_name: typeof fileName === "string" ? fileName : null,
    content_type: typeof contentType === "string" ? contentType : null,
    size_bytes: typeof sizeBytes === "string" ? Number(sizeBytes) || null : null,
    uploaded_by: user.id,
  });

  revalidatePath(`/jobs/${jobId}`);
}

export async function submitCompletion(
  _prev: WorkState,
  formData: FormData,
): Promise<WorkState> {
  const user = await requireApprovedContractor();

  const parsed = completionSchema.safeParse({
    job_id: formData.get("job_id"),
    notes: formData.get("notes"),
    field_ticket_ref: formData.get("field_ticket_ref"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("contractor_submit_completion", {
    p_job_id: parsed.data.job_id,
    p_notes: parsed.data.notes,
    p_field_ticket_ref: parsed.data.field_ticket_ref,
    p_contractor_id: user.id,
  });

  if (error) {
    // The database's messages here are already written for a person to read
    // ("at least one after photo is required").
    return { error: error.message.replace(/^.*?:\s*/, "") };
  }

  revalidatePath(`/jobs/${parsed.data.job_id}`);
  return { success: "Submitted for review." };
}
