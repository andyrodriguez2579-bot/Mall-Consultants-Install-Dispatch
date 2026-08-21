"use server";

import { revalidatePath } from "next/cache";
import { INVOICE_RECIPIENT_EMAIL, ORG_NAME } from "@/lib/branding";
import { requireAdmin } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { invoiceEmail } from "@/lib/email/invoice-template";
import { formatAddress, parseMoneyToCents } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "../actions";
import type { Invoice, InvoiceLineItem, Job, JobPricing } from "@/lib/types";

/**
 * Invoicing.
 *
 * A job's own pricing (job_pricing, job_service_lines) is frozen once it is
 * dispatched -- it is what a contractor agreed to be paid, and it must not
 * move. An invoice is a different document: creating one copies that pricing
 * once, into invoice_line_items, and from then on the two are unrelated rows.
 * Editing the invoice -- striking a line, correcting an address, adding a
 * note -- cannot touch what the contractor was promised.
 *
 * Same draft/frozen shape as job pricing: editable while a draft, fixed the
 * moment it sends. The database enforces this independently (0024's
 * enforce_invoice_editable trigger); the checks here are for a clean error
 * message rather than the actual guarantee.
 */

interface DraftLine {
  description: string;
  unit_price_cents: number;
  quantity: number;
  sort_order: number;
}

/** Everything a job's pricing implies should be billed to the customer. */
function linesFromJobPricing(
  job: Job,
  pricing: JobPricing | null,
  serviceLines: Array<{ description: string; unit_price_cents: number; quantity: number | string }>,
): DraftLine[] {
  const lines: DraftLine[] = serviceLines.map((row) => ({
    description: row.description,
    unit_price_cents: row.unit_price_cents,
    quantity: Number(row.quantity),
    sort_order: 0,
  }));

  if (pricing && pricing.additional_labor_cents > 0) {
    lines.push({
      description: pricing.additional_labor_reason
        ? `Additional labor -- ${pricing.additional_labor_reason}`
        : "Additional labor",
      unit_price_cents: pricing.additional_labor_cents,
      quantity: 1,
      sort_order: 0,
    });
  }

  if (job.mileage_payment_cents > 0) {
    lines.push({
      description: `Mileage -- ${Number(job.payable_miles)} payable miles at $${Number(job.mileage_rate).toFixed(4)}/mi`,
      unit_price_cents: job.mileage_payment_cents,
      quantity: 1,
      sort_order: 0,
    });
  }

  const expenses: Array<[number, string]> = [
    [job.materials_cents, "Materials"],
    [job.tolls_parking_cents, "Tolls and parking"],
    [job.hotel_cents, "Hotel"],
    [job.other_expenses_cents, "Other expenses"],
  ];
  for (const [cents, label] of expenses) {
    if (cents > 0) lines.push({ description: label, unit_price_cents: cents, quantity: 1, sort_order: 0 });
  }

  return lines.map((line, index) => ({ ...line, sort_order: index }));
}

/**
 * Read the job's current pricing into a fresh draft invoice.
 *
 * Blocked at the database by the one-live-invoice-per-job index if a draft or
 * a sent invoice already exists; that shows up here as a failed insert, which
 * is fine to ignore -- the button that calls this is not shown once a live
 * invoice exists.
 */
export async function createInvoiceDraft(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return;

  const supabase = await createClient();

  const [{ data: job }, { data: pricing }, { data: serviceLines }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle<Job>(),
    supabase.from("job_pricing").select("*").eq("job_id", jobId).maybeSingle<JobPricing>(),
    supabase
      .from("job_service_lines")
      .select("description, unit_price_cents, quantity")
      .eq("job_id", jobId)
      .order("sort_order"),
  ]);

  if (!job) return;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      job_id: jobId,
      bill_to_name: job.customer_name,
      bill_to_address: formatAddress(job),
      created_by: admin.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !invoice) {
    revalidatePath(`/admin/jobs/${jobId}`);
    return;
  }

  const lines = linesFromJobPricing(
    job,
    pricing,
    (serviceLines ?? []) as Array<{
      description: string;
      unit_price_cents: number;
      quantity: number | string;
    }>,
  );

  if (lines.length > 0) {
    await supabase
      .from("invoice_line_items")
      .insert(lines.map((line) => ({ invoice_id: invoice.id, ...line })));
  }

  revalidatePath(`/admin/jobs/${jobId}`);
}

/**
 * The line items the invoice editor emits, read the same way the pricing
 * panel's lines are (see `src/lib/pricing-form.ts`'s `readLines`): parallel
 * arrays, one entry per line, blank rows dropped.
 */
function readInvoiceLines(formData: FormData): DraftLine[] {
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

    lines.push({ description, unit_price_cents, quantity, sort_order: lines.length });
  }
  return lines;
}

/** Save edits to a draft invoice -- bill-to, notes, and the line items. */
export async function updateInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const invoiceId = formData.get("invoice_id");
  const jobId = formData.get("job_id");
  if (typeof invoiceId !== "string" || typeof jobId !== "string") {
    return { error: "Missing invoice." };
  }

  const lines = readInvoiceLines(formData);
  if (lines.length === 0) {
    return { errors: { lines: "Add at least one line before saving." } };
  }
  for (const [index, line] of lines.entries()) {
    if (!line.description) return { errors: { lines: `Line ${index + 1} needs a description.` } };
    if (line.unit_price_cents <= 0) return { errors: { lines: `Line ${index + 1} needs an amount.` } };
  }

  const billToName = formData.get("bill_to_name");
  const billToAddress = formData.get("bill_to_address");
  const notes = formData.get("notes");

  const supabase = await createClient();

  const { error } = await supabase
    .from("invoices")
    .update({
      bill_to_name: typeof billToName === "string" ? billToName.trim() || null : null,
      bill_to_address: typeof billToAddress === "string" ? billToAddress.trim() || null : null,
      notes: typeof notes === "string" ? notes.trim() || null : null,
    })
    .eq("id", invoiceId);

  if (error) {
    return {
      error: /fixed once it is no longer a draft/.test(error.message)
        ? "This invoice has already been sent and can no longer be changed."
        : error.message,
    };
  }

  // Replaced wholesale, same reasoning as job_service_lines: lines carry no
  // identity a person relies on, and a partial update would leave an invoice
  // billed for something nobody chose.
  await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
  const { error: linesError } = await supabase
    .from("invoice_line_items")
    .insert(lines.map((line) => ({ invoice_id: invoiceId, ...line })));

  if (linesError) return { error: linesError.message };

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: "Saved." };
}

/**
 * Send the invoice exactly as currently saved -- not whatever is unsaved in
 * the browser, so "send" always matches what "save changes" last wrote.
 */
export async function sendInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const invoiceId = formData.get("invoice_id");
  const jobId = formData.get("job_id");
  if (typeof invoiceId !== "string" || typeof jobId !== "string") {
    return { error: "Missing invoice." };
  }

  const admin = createAdminClient();

  const [{ data: invoice }, { data: lineRows }, { data: job }] = await Promise.all([
    admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle<Invoice>(),
    admin
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("sort_order")
      .returns<InvoiceLineItem[]>(),
    admin.from("jobs").select("*").eq("id", jobId).maybeSingle<Job>(),
  ]);

  if (!invoice || !job) return { error: "Invoice not found." };
  if (invoice.status !== "draft") {
    return { error: `This invoice is already ${invoice.status}.` };
  }
  if (!lineRows || lineRows.length === 0) {
    return { errors: { lines: "Add at least one line before sending." } };
  }

  const { subject, body } = invoiceEmail(
    {
      invoiceNumber: invoice.invoice_number,
      jobNumber: job.job_number,
      customerName: job.customer_name,
      siteAddress: formatAddress(job),
      accountNumber: job.account_number,
      billToName: invoice.bill_to_name,
      billToAddress: invoice.bill_to_address,
      notes: invoice.notes,
    },
    lineRows.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPriceCents: l.unit_price_cents,
      lineTotalCents: l.line_total_cents,
    })),
    invoice.subtotal_cents,
    ORG_NAME,
  );

  const result = await sendEmail({
    to: INVOICE_RECIPIENT_EMAIL,
    subject,
    body,
    purpose: "invoice",
    jobId,
    client: admin,
  });

  if (!result.ok) {
    await admin
      .from("invoices")
      .update({ send_error: result.error ?? "Could not send." })
      .eq("id", invoiceId);
    revalidatePath(`/admin/jobs/${jobId}`);
    return { error: result.error ?? "Could not send the invoice. Try again." };
  }

  await admin
    .from("invoices")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to_email: INVOICE_RECIPIENT_EMAIL,
      email_message_id: result.messageId,
      send_error: null,
    })
    .eq("id", invoiceId);

  await admin.rpc("write_audit", {
    p_entity_type: "job",
    p_entity_id: jobId,
    p_action: "job.invoice_sent",
    p_detail: {
      invoice_number: invoice.invoice_number,
      total_cents: invoice.subtotal_cents,
      sent_to: INVOICE_RECIPIENT_EMAIL,
    },
  });

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: `Sent invoice INV-${invoice.invoice_number} to ${INVOICE_RECIPIENT_EMAIL}.` };
}

/** Call off an invoice -- from either state -- so a corrected one can be issued. */
export async function voidInvoice(formData: FormData): Promise<void> {
  await requireAdmin();
  const invoiceId = formData.get("invoice_id");
  const jobId = formData.get("job_id");
  const reason = formData.get("reason");
  if (typeof invoiceId !== "string" || typeof jobId !== "string") return;

  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .update({
      status: "void",
      voided_at: new Date().toISOString(),
      void_reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    })
    .eq("id", invoiceId)
    .select("invoice_number")
    .maybeSingle<{ invoice_number: number }>();

  if (invoice) {
    await supabase.rpc("write_audit", {
      p_entity_type: "job",
      p_entity_id: jobId,
      p_action: "job.invoice_voided",
      p_detail: { invoice_number: invoice.invoice_number },
    });
  }

  revalidatePath(`/admin/jobs/${jobId}`);
}
