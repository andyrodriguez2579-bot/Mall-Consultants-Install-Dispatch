"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { sendSms, templates } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Job, Profile } from "@/lib/types";
import { readMulti } from "@/lib/validation";

export interface PaymentState {
  error?: string;
  success?: string;
}

/**
 * Record a Friday payment run.
 *
 * Contractors are paid manually outside this system; this writes the ledger
 * entry saying it happened. The batch is recorded in a single transaction, so
 * a run is never half-recorded, and every amount comes from the job's frozen
 * pay rather than from anything typed here.
 */
export async function recordPaymentRun(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const admin = await requireAdmin();

  const jobIds = readMulti(formData, "job_ids");
  const reference = formData.get("reference");
  const method = formData.get("method");

  if (jobIds.length === 0) {
    return { error: "Select at least one job to mark paid." };
  }
  if (typeof reference !== "string" || reference.trim().length === 0) {
    return { error: "Record a payment reference for this run." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_mark_paid_batch", {
    p_job_ids: jobIds,
    p_reference: reference.trim(),
    p_method: typeof method === "string" && method ? method : null,
    p_admin_id: admin.id,
  });

  if (error) return { error: error.message };

  // Tell each contractor their money is on the way. Best-effort: the payment is
  // already recorded and a failed text must not undo it.
  const client = createAdminClient();
  const { data: paid } = await client
    .from("jobs")
    .select(
      "id, job_number, contractor_pay_cents, currency, payment_reference, assigned_contractor_id",
    )
    .in("id", jobIds);

  for (const job of (paid ?? []) as Array<
    Pick<
      Job,
      | "id"
      | "job_number"
      | "contractor_pay_cents"
      | "currency"
      | "payment_reference"
      | "assigned_contractor_id"
    >
  >) {
    if (!job.assigned_contractor_id) continue;

    const { data: contractor } = await client
      .from("profiles")
      .select("phone")
      .eq("id", job.assigned_contractor_id)
      .maybeSingle<Pick<Profile, "phone">>();

    if (!contractor?.phone) continue;

    await sendSms({
      to: contractor.phone,
      body: templates.paidSms(job, job.payment_reference),
      purpose: "job_paid",
      jobId: job.id,
      contractorId: job.assigned_contractor_id,
      client,
    });
  }

  revalidatePath("/admin/payments");
  const count = (data as number | null) ?? jobIds.length;
  return { success: `Recorded payment for ${count} job${count === 1 ? "" : "s"}.` };
}
