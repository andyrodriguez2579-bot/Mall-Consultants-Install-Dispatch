import { authorizeAutomation } from "@/lib/automation/auth";
import {
  installRequestPayload,
  parseDateOnly,
  parseTimestamp,
  reviewVerdict,
} from "@/lib/automation/install-request";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Intake for the Outlook automation.
 *
 * One installation email in, one install_request out. It deliberately does not
 * create a job: conversion already exists as an administrator's action with a
 * review screen in front of it, and putting an automated writer on that path
 * would mean an AI's reading of an email dispatching a contractor to an address
 * nobody had looked at. The request queue is where automation stops.
 *
 * Answers are shaped for a retrying caller. A duplicate is 200, not an error --
 * n8n retried, the work is already recorded, and there is nothing for it to do
 * differently. A malformed payload is 400 and will never succeed on retry. A
 * database failure is 503, which is the one worth trying again.
 */
export async function POST(request: Request) {
  const auth = authorizeAutomation(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = installRequestPayload.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "The payload could not be read.",
        // Field paths only. The caller is a workflow being tuned by hand, and
        // "which field" is the entire question it needs answered.
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join(".") || "(root)",
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  // Checked before inserting so a repeat gets the id of the request it already
  // made, rather than an error it has to interpret. The unique index below is
  // still what guarantees it -- two retries can arrive at once.
  const { data: existing } = await admin
    .from("install_requests")
    .select("id, job_id, status")
    .eq("source_message_id", payload.source_email_message_id)
    .maybeSingle<{ id: string; job_id: string | null; status: string }>();

  if (existing) {
    return Response.json({
      ok: true,
      duplicate: true,
      request_id: existing.id,
      job_id: existing.job_id,
      status: existing.status,
      message: "This email has already been received.",
    });
  }

  const verdict = reviewVerdict(payload);

  const { data: created, error } = await admin
    .from("install_requests")
    .insert({
      status: "new",
      source: "automation",
      raw_text: payload.raw_text,
      received_at:
        parseTimestamp(payload.source_email_received_at) ?? new Date().toISOString(),
      source_message_id: payload.source_email_message_id,
      source_conversation_id: payload.source_email_conversation_id ?? null,
      source_sender: payload.source_email_sender ?? null,
      source_subject: payload.source_email_subject ?? null,
      source_received_at: parseTimestamp(payload.source_email_received_at),
      needs_review: verdict.needsReview,
      review_reason: verdict.reason,
      // The extraction is kept whole rather than spread across columns. The
      // review screen reads it, and keeping it intact means a parser improved
      // later can be re-run against what was actually received.
      parsed: {
        prime_contractor: payload.prime_contractor ?? null,
        operating_company: payload.operating_company ?? null,
        rsm_name: payload.rsm_name ?? null,
        customer_name: payload.customer_name ?? null,
        site_name: payload.site_name ?? null,
        installation_address: payload.installation_address ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        zip: payload.zip ?? null,
        site_contact_name: payload.site_contact_name ?? null,
        site_contact_email: payload.site_contact_email ?? null,
        site_contact_phone: payload.site_contact_phone ?? null,
        equipment_type: payload.equipment_type ?? null,
        equipment_model: payload.equipment_model ?? null,
        work_order_number: payload.work_order_number ?? null,
        po_number: payload.po_number ?? null,
        account_number: payload.account_number ?? null,
        requested_completion_date: parseDateOnly(payload.requested_completion_date),
        required_by_date: parseDateOnly(payload.required_by_date),
        installation_notes: payload.installation_notes ?? null,
        missing_fields: payload.missing_fields ?? [],
      },
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    // The unique index firing means two retries raced and the other one won.
    // That is a success from the caller's point of view.
    if (/duplicate key|unique/i.test(error.message)) {
      const { data: raced } = await admin
        .from("install_requests")
        .select("id, job_id, status")
        .eq("source_message_id", payload.source_email_message_id)
        .maybeSingle<{ id: string; job_id: string | null; status: string }>();

      if (raced) {
        return Response.json({
          ok: true,
          duplicate: true,
          request_id: raced.id,
          job_id: raced.job_id,
          status: raced.status,
          message: "This email has already been received.",
        });
      }
    }

    console.error("automation/install-request: insert failed", {
      code: error.code,
      message: error.message,
      details: error.details,
    });

    // Retry-safe: nothing was written, and the caller should come back.
    return Response.json(
      { ok: false, error: "Could not record the request. Try again." },
      { status: 503 },
    );
  }

  await admin.rpc("write_audit", {
    p_entity_type: "install_request",
    p_entity_id: created.id,
    p_action: "automation.request_created",
    p_detail: {
      source_message_id: payload.source_email_message_id,
      source_sender: payload.source_email_sender ?? null,
      source_subject: payload.source_email_subject ?? null,
      needs_review: verdict.needsReview,
      review_reason: verdict.reason,
      missing_fields: payload.missing_fields ?? [],
    },
  });

  return Response.json(
    {
      ok: true,
      duplicate: false,
      request_id: created.id,
      needs_review: verdict.needsReview,
      review_reason: verdict.reason,
      review_url: `/admin/requests/${created.id}`,
    },
    { status: 201 },
  );
}
