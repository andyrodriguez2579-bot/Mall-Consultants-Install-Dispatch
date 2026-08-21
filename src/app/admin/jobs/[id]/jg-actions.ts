"use server";

import { revalidatePath } from "next/cache";
import { INVOICE_RECIPIENT_EMAIL, ORG_NAME } from "@/lib/branding";
import { requireAdmin } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { JG_RATE_CARD } from "@/lib/jg/rate-card";
import { buildJgWorkbookBuffer } from "@/lib/jg/workbook";
import { parseMoneyToCents } from "@/lib/format";
import { getValidQuickbooksConnection } from "@/lib/quickbooks/connection";
import { createQuickbooksInvoice, recordQuickbooksPayment } from "@/lib/quickbooks/invoices";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "../actions";
import type { Job, JgSubmission, JgSubmissionLine } from "@/lib/types";

/**
 * Reporting a job to JG Installations, who pays Mall Consultants for it.
 *
 * A different party, a different rate card, and a different form than the
 * 0024 customer invoice: JG sets fixed prices per task
 * (src/lib/jg/rate-card.ts, taken from their own submission workbook) and
 * expects their own workbook back, filled in. This module builds that
 * report the same draft/edit/send shape as the invoice, and never touches
 * `email jginstallations@yahoo.com` for anything else.
 */

interface DraftLine {
  rate_card_item_id: string | null;
  category: string;
  description: string;
  unit_price_cents: number;
  quantity: number;
  sort_order: number;
}

/** Read the submission form's line rows, the same parallel-array shape as the invoice editor. */
function readSubmissionLines(formData: FormData): DraftLine[] {
  const itemIds = formData.getAll("line_rate_card_item_id");
  const categories = formData.getAll("line_category");
  const descriptions = formData.getAll("line_description");
  const prices = formData.getAll("line_unit_price");
  const quantities = formData.getAll("line_quantity");

  const lines: DraftLine[] = [];
  for (let i = 0; i < descriptions.length; i += 1) {
    const description = String(descriptions[i] ?? "").trim();
    const unit_price_cents = parseMoneyToCents(String(prices[i] ?? "")) ?? 0;
    const quantityRaw = Number(String(quantities[i] ?? "1"));
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 0;

    if (!description && unit_price_cents === 0) continue;

    lines.push({
      rate_card_item_id: String(itemIds[i] ?? "").trim() || null,
      category: String(categories[i] ?? "").trim() || "OTHER",
      description,
      unit_price_cents,
      quantity,
      sort_order: lines.length,
    });
  }
  return lines;
}

const cents = (formData: FormData, name: string): number => {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  return parseMoneyToCents(raw) ?? 0;
};

const num = (formData: FormData, name: string, fallback = 0): number => {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Start a draft, prefilled from the job. No lines: JG's catalogue has no relation to the customer's, so nothing carries over automatically. */
export async function createJgSubmissionDraft(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle<Job>();
  if (!job) return;

  await supabase.from("jg_submissions").insert({
    job_id: jobId,
    account_name: job.customer_name,
    account_number: job.account_number,
    rsm_name: job.rsm_name,
    opco: job.program_name,
    start_mileage: job.start_odometer ?? 0,
    end_mileage: job.end_odometer ?? 0,
    commuter_miles: job.excluded_miles,
    mileage_rate: job.mileage_rate,
    mileage_cents: job.mileage_payment_cents,
    hotel_cents: job.hotel_cents,
    tolls_parking_cents: job.tolls_parking_cents,
    created_by: admin.id,
  });

  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Save edits to a draft submission -- header fields, mileage, receipts and lines. */
export async function updateJgSubmission(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const submissionId = formData.get("submission_id");
  const jobId = formData.get("job_id");
  if (typeof submissionId !== "string" || typeof jobId !== "string") {
    return { error: "Missing submission." };
  }

  const lines = readSubmissionLines(formData);
  for (const [index, line] of lines.entries()) {
    if (!line.description) return { errors: { lines: `Line ${index + 1} needs a description.` } };
    if (line.unit_price_cents <= 0) return { errors: { lines: `Line ${index + 1} needs an amount.` } };
  }

  const text = (name: string) => {
    const raw = formData.get(name);
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  };

  const supabase = await createClient();

  const { error } = await supabase
    .from("jg_submissions")
    .update({
      account_name: text("account_name"),
      account_number: text("account_number"),
      rsm_name: text("rsm_name"),
      opco: text("opco"),
      start_mileage: num(formData, "start_mileage"),
      end_mileage: num(formData, "end_mileage"),
      commuter_miles: num(formData, "commuter_miles"),
      mileage_rate: num(formData, "mileage_rate"),
      mileage_cents: cents(formData, "mileage_amount"),
      home_depot_cents: cents(formData, "home_depot"),
      lowes_cents: cents(formData, "lowes"),
      harbor_freight_cents: cents(formData, "harbor_freight"),
      local_hardware_cents: cents(formData, "local_hardware"),
      hotel_cents: cents(formData, "hotel"),
      tolls_parking_cents: cents(formData, "tolls_parking"),
    })
    .eq("id", submissionId);

  if (error) {
    return {
      error: /no longer a draft/.test(error.message)
        ? "This submission has already been sent and can no longer be changed."
        : error.message,
    };
  }

  await supabase.from("jg_submission_lines").delete().eq("submission_id", submissionId);
  if (lines.length > 0) {
    const { error: linesError } = await supabase
      .from("jg_submission_lines")
      .insert(lines.map((line) => ({ submission_id: submissionId, ...line })));
    if (linesError) return { error: linesError.message };
  }

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: "Saved." };
}

/** Send the submission exactly as currently saved, with the filled JG workbook attached. */
export async function sendJgSubmission(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const submissionId = formData.get("submission_id");
  const jobId = formData.get("job_id");
  if (typeof submissionId !== "string" || typeof jobId !== "string") {
    return { error: "Missing submission." };
  }

  const admin = createAdminClient();

  const [{ data: submission }, { data: lineRows }, { data: job }] = await Promise.all([
    admin.from("jg_submissions").select("*").eq("id", submissionId).maybeSingle<JgSubmission>(),
    admin
      .from("jg_submission_lines")
      .select("*")
      .eq("submission_id", submissionId)
      .order("sort_order")
      .returns<JgSubmissionLine[]>(),
    admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle<Pick<Job, "job_number">>(),
  ]);

  if (!submission || !job) return { error: "Submission not found." };
  if (submission.status !== "draft") return { error: `This submission is already ${submission.status}.` };

  const lines = (lineRows ?? []).map((l) => ({
    rateCardItemId: l.rate_card_item_id,
    category: l.category,
    description: l.description,
    unitPriceCents: l.unit_price_cents,
    quantity: Number(l.quantity),
    lineTotalCents: l.line_total_cents,
  }));

  const workbook = buildJgWorkbookBuffer(
    {
      accountName: submission.account_name,
      accountNumber: submission.account_number,
      rsmName: submission.rsm_name,
      opco: submission.opco,
      startMileage: Number(submission.start_mileage),
      endMileage: Number(submission.end_mileage),
      commuterMiles: Number(submission.commuter_miles),
      mileageCents: submission.mileage_cents,
      homeDepotCents: submission.home_depot_cents,
      lowesCents: submission.lowes_cents,
      harborFreightCents: submission.harbor_freight_cents,
      localHardwareCents: submission.local_hardware_cents,
      hotelCents: submission.hotel_cents,
      tollsParkingCents: submission.tolls_parking_cents,
    },
    lines,
    submission.lines_subtotal_cents,
    JG_RATE_CARD,
  );

  const accountLabel = submission.account_name ?? "job";
  const filename = `JG-Submission-${job.job_number}.xlsx`;

  const result = await sendEmail({
    to: INVOICE_RECIPIENT_EMAIL,
    subject: `JG Submission -- ${accountLabel} (Job ${job.job_number})`,
    body:
      `Job report attached for ${accountLabel}, job ${job.job_number}.\n\n` +
      `Total job $: ${(submission.lines_subtotal_cents / 100).toFixed(2)}\n` +
      `Mileage $: ${(submission.mileage_cents / 100).toFixed(2)}\n\n` +
      `${ORG_NAME}`,
    purpose: "jg_submission",
    jobId,
    attachments: [{ filename, content: workbook, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
    client: admin,
  });

  if (!result.ok) {
    await admin
      .from("jg_submissions")
      .update({ send_error: result.error ?? "Could not send." })
      .eq("id", submissionId);
    revalidatePath(`/admin/jobs/${jobId}`);
    return { error: result.error ?? "Could not send the submission. Try again." };
  }

  await admin
    .from("jg_submissions")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to_email: INVOICE_RECIPIENT_EMAIL,
      email_message_id: result.messageId,
      send_error: null,
    })
    .eq("id", submissionId);

  await admin.rpc("write_audit", {
    p_entity_type: "job",
    p_entity_id: jobId,
    p_action: "job.jg_submission_sent",
    p_detail: {
      total_cents: submission.lines_subtotal_cents,
      sent_to: INVOICE_RECIPIENT_EMAIL,
    },
  });

  // Best-effort and never sent to JG -- this is Mall Consultants' own copy
  // of what they are owed for the job, for their own books. Not connecting
  // QuickBooks, or QuickBooks being briefly unreachable, must not stop the
  // actual submission to JG above, which already succeeded.
  try {
    const connection = await getValidQuickbooksConnection(admin);
    if (connection) {
      const { id: quickbooksInvoiceId } = await createQuickbooksInvoice(connection, {
        customerName: "JG Installations",
        billEmail: null,
        memo: `Job ${job.job_number}${submission.account_name ? ` -- ${submission.account_name}` : ""}`,
        description: `Installation -- Job ${job.job_number}`,
        totalCents: submission.lines_subtotal_cents,
      });
      await admin
        .from("jg_submissions")
        .update({ quickbooks_invoice_id: quickbooksInvoiceId, quickbooks_synced_at: new Date().toISOString() })
        .eq("id", submissionId);
    }
  } catch (cause) {
    console.error("sendJgSubmission: QuickBooks sync failed", cause);
  }

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: `Sent to ${INVOICE_RECIPIENT_EMAIL}.` };
}

/**
 * Record that JG paid, both here and (if connected) in QuickBooks -- where
 * recording a payment against the invoice is what actually clears its
 * balance, not a status flag.
 */
export async function markJgSubmissionPaid(formData: FormData): Promise<void> {
  await requireAdmin();
  const submissionId = formData.get("submission_id");
  const jobId = formData.get("job_id");
  if (typeof submissionId !== "string" || typeof jobId !== "string") return;

  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("jg_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle<JgSubmission>();

  if (!submission || submission.status !== "sent" || submission.paid_at) return;

  await admin
    .from("jg_submissions")
    .update({ paid_at: new Date().toISOString(), paid_amount_cents: submission.lines_subtotal_cents })
    .eq("id", submissionId);

  if (submission.quickbooks_invoice_id) {
    try {
      const connection = await getValidQuickbooksConnection(admin);
      if (connection) {
        await recordQuickbooksPayment(connection, {
          quickbooksInvoiceId: submission.quickbooks_invoice_id,
          customerName: "JG Installations",
          amountCents: submission.lines_subtotal_cents,
        });
      }
    } catch (cause) {
      console.error("markJgSubmissionPaid: QuickBooks sync failed", cause);
    }
  }

  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Call off a submission -- from either state -- so a corrected one can be issued. */
export async function voidJgSubmission(formData: FormData): Promise<void> {
  await requireAdmin();
  const submissionId = formData.get("submission_id");
  const jobId = formData.get("job_id");
  const reason = formData.get("reason");
  if (typeof submissionId !== "string" || typeof jobId !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("jg_submissions")
    .update({
      status: "void",
      voided_at: new Date().toISOString(),
      void_reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    })
    .eq("id", submissionId);

  revalidatePath(`/admin/jobs/${jobId}`);
}
