"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dispatchJob } from "@/lib/dispatch";
import { appBaseUrl } from "@/lib/env";
import { sendSms, templates } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  readPricingForm,
  upsertJobPricing,
  validatePricing,
} from "@/lib/pricing-form";
import type { Job, Profile } from "@/lib/types";
import {
  dispatchSchema,
  fieldErrors,
  jobFormSchema,
  paymentSchema,
  readMulti,
  reworkSchema,
} from "@/lib/validation";

/** Work order fields withheld from a contractor until the job is theirs. */
function readWorkOrderFields(formData: FormData) {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  return {
    site_contact_name: text("site_contact_name"),
    site_contact_phone: text("site_contact_phone"),
    access_notes: text("access_notes"),
    customer_reference: text("customer_reference"),
    account_number: text("account_number"),
  };
}

export interface FormState {
  errors?: Record<string, string>;
  error?: string;
  success?: string;
}

/** Read the job form out of FormData and validate it. */
function parseJobForm(formData: FormData) {
  return jobFormSchema.safeParse({
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
    contractor_pay: formData.get("contractor_pay") ?? "",
    scheduled_start: formData.get("scheduled_start") ?? "",
    scheduled_end: formData.get("scheduled_end") ?? "",
    deadline_at: formData.get("deadline_at") ?? "",
    skill_ids: readMulti(formData, "skill_ids"),
  });
}

export async function createJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = parseJobForm(formData);

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const pricing = readPricingForm(formData);
  const pricingErrors = validatePricing(pricing);
  if (pricingErrors) return { errors: pricingErrors };

  const { skill_ids, contractor_pay: _ignored, ...fields } = parsed.data;

  const supabase = await createClient();

  // "Save as draft" vs "Save as ready" -- ready jobs are dispatchable.
  const status = formData.get("intent") === "draft" ? "draft" : "ready";

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      ...readWorkOrderFields(formData),
      ...pricing.jobFields,
      status,
      created_by: admin.id,
    })
    .select("id")
    .single<Pick<Job, "id">>();

  if (error || !job) {
    return { error: error?.message ?? "Could not create the job." };
  }

  // The customer side lands in job_pricing, which contractors cannot read.
  // A trigger mirrors the derived labor pay back onto the job.
  const { error: pricingError } = await upsertJobPricing(supabase, job.id, pricing, admin.id);
  if (pricingError) return { error: pricingError };

  if (skill_ids.length > 0) {
    await supabase
      .from("job_skills")
      .insert(skill_ids.map((skill_id) => ({ job_id: job.id, skill_id })));
  }

  revalidatePath("/admin/jobs");
  redirect(`/admin/jobs/${job.id}`);
}

export async function updateJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return { error: "Missing job." };

  const parsed = parseJobForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { skill_ids, contractor_pay: _unused, ...fields } = parsed.data;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single<Pick<Job, "status">>();

  if (!existing) return { error: "Job not found." };

  const editable = existing.status === "draft" || existing.status === "ready";
  const pricing = readPricingForm(formData);

  // Once a job is dispatched the labor inputs are locked, so the form does not
  // submit them. Validating them anyway would reject an edit whose only purpose
  // is to record the miles actually driven.
  const pricingErrors = editable ? validatePricing(pricing) : null;
  if (pricingErrors) return { errors: pricingErrors };

  // Mileage and reimbursables stay editable after dispatch -- they are only
  // knowable after the trip, and sit outside the labor agreement. The customer
  // pricing does not, and the database refuses it independently of this check.
  const { error } = await supabase
    .from("jobs")
    .update({
      ...fields,
      ...readWorkOrderFields(formData),
      ...pricing.jobFields,
      ...(editable ? {} : { service_item_id: undefined, service_type: undefined }),
    })
    .eq("id", jobId);

  if (error) return { error: error.message };

  if (editable) {
    const { error: pricingError } = await upsertJobPricing(supabase, jobId, pricing, admin.id);
    if (pricingError) {
      return {
        errors: {
          customer_labor_price:
            "Pricing is fixed once a job has been dispatched. Cancel and repost to change it.",
        },
      };
    }
  }

  // Required skills are replaced wholesale; simpler than diffing and the set
  // is always small.
  await supabase.from("job_skills").delete().eq("job_id", jobId);
  if (skill_ids.length > 0) {
    await supabase
      .from("job_skills")
      .insert(skill_ids.map((skill_id) => ({ job_id: jobId, skill_id })));
  }

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: "Job updated." };
}

/**
 * Copy a job into a fresh draft. Everything operational resets: no assignee, no
 * offers, no schedule history, a new job number.
 */
export async function duplicateJob(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single<Job>();

  if (!source) return;

  const { data: copy } = await supabase
    .from("jobs")
    .insert({
      title: `${source.title} (copy)`,
      customer_name: source.customer_name,
      site_name: source.site_name,
      address_line1: source.address_line1,
      address_line2: source.address_line2,
      city: source.city,
      state_code: source.state_code,
      postal_code: source.postal_code,
      scope: source.scope,
      instructions: source.instructions,
      currency: source.currency,
      service_item_id: source.service_item_id,
      service_type: source.service_type,
      mileage_rate: source.mileage_rate,
      status: "draft",
      created_by: admin.id,
    })
    .select("id")
    .single<Pick<Job, "id">>();

  if (!copy) return;

  // Carry the pricing across too, or the copy would be a free job.
  const { data: sourcePricing } = await supabase
    .from("job_pricing")
    .select("customer_labor_price_cents, task_count, contractor_percentage_bps")
    .eq("job_id", jobId)
    .maybeSingle<{
      customer_labor_price_cents: number;
      task_count: number;
      contractor_percentage_bps: number;
    }>();

  if (sourcePricing) {
    await supabase.from("job_pricing").insert({ job_id: copy.id, ...sourcePricing });
  }

  const { data: skills } = await supabase
    .from("job_skills")
    .select("skill_id")
    .eq("job_id", jobId);

  if (skills && skills.length > 0) {
    await supabase.from("job_skills").insert(
      (skills as Array<{ skill_id: string }>).map((s) => ({
        job_id: copy.id,
        skill_id: s.skill_id,
      })),
    );
  }

  revalidatePath("/admin/jobs");
  redirect(`/admin/jobs/${copy.id}`);
}

/** Open a dispatch round: text the selected contractors a secure link each. */
export async function dispatchJobAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const parsed = dispatchSchema.safeParse({
    job_id: formData.get("job_id"),
    contractor_ids: readMulti(formData, "contractor_ids"),
    expires_in_hours: formData.get("expires_in_hours") ?? 4,
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    const result = await dispatchJob({
      jobId: parsed.data.job_id,
      contractorIds: parsed.data.contractor_ids,
      expiresInHours: parsed.data.expires_in_hours,
      adminId: admin.id,
    });

    revalidatePath(`/admin/jobs/${parsed.data.job_id}`);

    if (result.offersSent === 0) {
      const reasons = result.failures.map((f) => f.reason).join(" ");
      return {
        error: `No offers went out. ${reasons || "Check the contractor records."}`,
      };
    }

    const suffix =
      result.offersFailed > 0
        ? ` ${result.offersFailed} could not be reached — see the offers list.`
        : "";

    return {
      success: `Offer sent to ${result.offersSent} contractor${
        result.offersSent === 1 ? "" : "s"
      }.${suffix}`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Dispatch failed." };
  }
}

export async function approveJob(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_approve_job", {
    p_job_id: jobId,
    p_admin_id: admin.id,
  });

  if (!error) {
    const client = createAdminClient();
    const { data: job } = await client
      .from("jobs")
      .select(
        "job_number, contractor_pay_cents, currency, assigned_contractor_id, scheduled_pay_date",
      )
      .eq("id", jobId)
      .single<
        Pick<
          Job,
          | "job_number"
          | "contractor_pay_cents"
          | "currency"
          | "assigned_contractor_id"
          | "scheduled_pay_date"
        >
      >();

    if (job?.assigned_contractor_id) {
      const { data: contractor } = await client
        .from("profiles")
        .select("phone")
        .eq("id", job.assigned_contractor_id)
        .single<Pick<Profile, "phone">>();

      if (contractor?.phone) {
        await sendSms({
          to: contractor.phone,
          body: templates.approvedSms(job),
          purpose: "job_approved",
          jobId,
          contractorId: job.assigned_contractor_id,
          client,
        });
      }
    }
  }

  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function requestRework(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const parsed = reworkSchema.safeParse({
    job_id: formData.get("job_id"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_request_rework", {
    p_job_id: parsed.data.job_id,
    p_notes: parsed.data.notes,
    p_admin_id: admin.id,
  });

  if (error) return { error: error.message };

  const client = createAdminClient();
  const { data: job } = await client
    .from("jobs")
    .select("job_number, assigned_contractor_id")
    .eq("id", parsed.data.job_id)
    .single<Pick<Job, "job_number" | "assigned_contractor_id">>();

  if (job?.assigned_contractor_id) {
    const { data: contractor } = await client
      .from("profiles")
      .select("phone")
      .eq("id", job.assigned_contractor_id)
      .single<Pick<Profile, "phone">>();

    if (contractor?.phone) {
      await sendSms({
        to: contractor.phone,
        body: templates.reworkSms(job, `${appBaseUrl()}/jobs/${parsed.data.job_id}`),
        purpose: "job_rework",
        jobId: parsed.data.job_id,
        contractorId: job.assigned_contractor_id,
        client,
      });
    }
  }

  revalidatePath(`/admin/jobs/${parsed.data.job_id}`);
  return { success: "Sent back to the contractor for rework." };
}

export async function markPaid(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();

  const parsed = paymentSchema.safeParse({
    job_id: formData.get("job_id"),
    reference: formData.get("reference"),
    method: formData.get("method"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_mark_paid", {
    p_job_id: parsed.data.job_id,
    p_reference: parsed.data.reference,
    p_method: parsed.data.method,
    p_admin_id: admin.id,
  });

  if (error) return { error: error.message };

  const client = createAdminClient();
  const { data: job } = await client
    .from("jobs")
    .select("job_number, contractor_pay_cents, currency, assigned_contractor_id, payment_reference")
    .eq("id", parsed.data.job_id)
    .single<
      Pick<
        Job,
        | "job_number"
        | "contractor_pay_cents"
        | "currency"
        | "assigned_contractor_id"
        | "payment_reference"
      >
    >();

  if (job?.assigned_contractor_id) {
    const { data: contractor } = await client
      .from("profiles")
      .select("phone")
      .eq("id", job.assigned_contractor_id)
      .single<Pick<Profile, "phone">>();

    if (contractor?.phone) {
      await sendSms({
        to: contractor.phone,
        body: templates.paidSms(job, job.payment_reference),
        purpose: "job_paid",
        jobId: parsed.data.job_id,
        contractorId: job.assigned_contractor_id,
        client,
      });
    }
  }

  revalidatePath(`/admin/jobs/${parsed.data.job_id}`);
  return { success: "Payment recorded." };
}

export async function assignContractor(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  const contractorId = formData.get("contractor_id");
  const reason = formData.get("reason");

  if (typeof jobId !== "string" || typeof contractorId !== "string" || !contractorId) {
    return { error: "Choose a contractor to assign." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_contractor", {
    p_job_id: jobId,
    p_contractor_id: contractorId,
    p_reason: typeof reason === "string" ? reason : null,
    p_admin_id: admin.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: "Contractor assigned." };
}

export async function cancelJob(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  const reason = formData.get("reason");

  if (typeof jobId !== "string") return { error: "Missing job." };
  if (typeof reason !== "string" || reason.trim().length < 3) {
    return { errors: { reason: "Give a short reason for cancelling." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_job", {
    p_job_id: jobId,
    p_reason: reason,
    p_admin_id: admin.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: "Job cancelled." };
}

/** Put a job back into the dispatchable pool without reposting it by hand. */
export async function reopenForDispatch(formData: FormData): Promise<void> {
  await requireAdmin();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({ status: "ready", offer_expires_at: null })
    .eq("id", jobId)
    .in("status", ["unfilled", "on_hold", "cancelled"]);

  revalidatePath(`/admin/jobs/${jobId}`);
}
