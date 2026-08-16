import { appBaseUrl, offerTtlHours } from "@/lib/env";
import { profilesByIds } from "@/lib/people";
import { sendSms, templates } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken, hashToken } from "@/lib/tokens";
import type { Job, JobOffer, Profile } from "@/lib/types";

/**
 * Dispatch: turning a job into a set of secure, single-contractor offers.
 *
 * Runs with the service-role client because it has to read other people's
 * phone numbers and write offer rows. Callers are responsible for having
 * established that the actor is an administrator -- every entry point here is
 * reached from a server action that has already called requireAdmin().
 */

export const offerUrl = (token: string) => `${appBaseUrl()}/offer/${token}`;

export interface DispatchResult {
  offersSent: number;
  offersFailed: number;
  expiresAt: string;
  round: number;
  failures: Array<{ contractorId: string; reason: string }>;
}

const DISPATCHABLE_FROM: Job["status"][] = ["draft", "ready", "unfilled", "on_hold"];

/**
 * Open a new dispatch round for a job and text every selected contractor a
 * link that is unique to them.
 *
 * Each contractor gets their own 256-bit token, so a forwarded link is
 * traceable and revocable, and one contractor can never act as another.
 */
export async function dispatchJob({
  jobId,
  contractorIds,
  expiresInHours = offerTtlHours(),
  adminId,
}: {
  jobId: string;
  contractorIds: string[];
  expiresInHours?: number;
  adminId: string;
}): Promise<DispatchResult> {
  const supabase = createAdminClient();

  if (contractorIds.length === 0) {
    throw new Error("Select at least one contractor to dispatch to.");
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single<Job>();

  if (jobError || !job) throw new Error("Job not found.");

  if (!DISPATCHABLE_FROM.includes(job.status)) {
    throw new Error(
      `A job in "${job.status}" cannot be dispatched. Cancel or reset it first.`,
    );
  }

  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  const round = job.offer_round + 1;

  // Flip the job into the offered state before any SMS goes out. If a message
  // fails, contractors who did receive one still land on a live job rather than
  // a closed one.
  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "offered",
      offer_expires_at: expiresAt,
      offer_round: round,
      unfilled_at: null,
    })
    .eq("id", jobId);

  if (updateError) throw new Error(`Could not open the dispatch round: ${updateError.message}`);

  // Only approved, active, SMS-reachable contractors are ever texted, whatever
  // the caller passed in.
  const { data: recipients, error: recipientsError } = await supabase
    .from("contractors")
    .select("id, status, sms_opt_in")
    .in("id", contractorIds)
    .eq("status", "approved");

  if (recipientsError) {
    throw new Error(`Could not read the contractor list: ${recipientsError.message}`);
  }

  type RecipientRow = { id: string; sms_opt_in: boolean };
  const approved = (recipients ?? []) as RecipientRow[];
  const people = await profilesByIds(
    supabase,
    approved.map((r) => r.id),
  );

  const eligible = approved
    .map((r) => ({ ...r, profile: people.get(r.id) ?? null }))
    .filter((r) => r.profile?.is_active && r.profile.phone && r.sms_opt_in);

  const failures: DispatchResult["failures"] = [];
  for (const id of contractorIds) {
    if (!eligible.some((r) => r.id === id)) {
      failures.push({
        contractorId: id,
        reason: "Not approved, inactive, opted out of SMS, or has no phone number.",
      });
    }
  }

  let offersSent = 0;

  for (const recipient of eligible) {
    const token = generateToken();

    const { data: offer, error: offerError } = await supabase
      .from("job_offers")
      .insert({
        job_id: jobId,
        contractor_id: recipient.id,
        round,
        status: "pending",
        token_hash: hashToken(token),
        expires_at: expiresAt,
      })
      .select("id")
      .single<Pick<JobOffer, "id">>();

    if (offerError || !offer) {
      failures.push({
        contractorId: recipient.id,
        reason: offerError?.message ?? "Could not create the offer.",
      });
      continue;
    }

    const outcome = await sendSms({
      to: recipient.profile!.phone!,
      body: templates.offerSms({
        job,
        link: offerUrl(token),
        expiresInHours,
      }),
      purpose: "job_offer",
      jobId,
      contractorId: recipient.id,
      client: supabase,
    });

    await supabase
      .from("job_offers")
      .update({
        status: outcome.ok ? "sent" : "failed",
        sent_at: outcome.ok ? new Date().toISOString() : null,
        failure_reason: outcome.error ?? null,
        sms_message_id: outcome.messageId,
      })
      .eq("id", offer.id);

    if (outcome.ok) {
      offersSent += 1;
    } else {
      failures.push({
        contractorId: recipient.id,
        reason: outcome.error ?? "Message could not be sent.",
      });
    }
  }

  await supabase.rpc("write_audit", {
    p_entity_type: "job",
    p_entity_id: jobId,
    p_action: "job.dispatched",
    p_detail: {
      job_number: job.job_number,
      round,
      requested: contractorIds.length,
      sent: offersSent,
      failed: failures.length,
      expires_at: expiresAt,
    },
    p_actor_id: adminId,
  });

  return {
    offersSent,
    offersFailed: failures.length,
    expiresAt,
    round,
    failures,
  };
}

/**
 * Fan out the consequences of an acceptance: confirm to the winner, tell the
 * administrator, and close the loop with everyone else who was asked.
 *
 * Notifications are best-effort and deliberately never throw. The assignment is
 * already committed by the time this runs, and a failed courtesy text must not
 * surface to the contractor as a failed acceptance.
 */
export async function notifyAcceptance({
  jobId,
  winnerContractorId,
}: {
  jobId: string;
  winnerContractorId: string;
}): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single<Job>();
    if (!job) return;

    const { data: winner } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .eq("id", winnerContractorId)
      .single<Pick<Profile, "id" | "full_name" | "phone">>();

    if (winner?.phone) {
      await sendSms({
        to: winner.phone,
        body: templates.assignedSms(job, `${appBaseUrl()}/jobs/${jobId}`),
        purpose: "job_assigned",
        jobId,
        contractorId: winnerContractorId,
        client: supabase,
      });
    }

    // Everyone else who held a live offer in this round.
    const { data: losers } = await supabase
      .from("job_offers")
      .select("contractor_id")
      .eq("job_id", jobId)
      .eq("round", job.offer_round)
      .eq("status", "filled");

    const loserIds = ((losers ?? []) as Array<{ contractor_id: string }>).map(
      (l) => l.contractor_id,
    );
    const loserPeople = await profilesByIds(supabase, loserIds);

    for (const contractorId of loserIds) {
      const phone = loserPeople.get(contractorId)?.phone;
      if (!phone) continue;
      await sendSms({
        to: phone,
        body: templates.filledSms(job),
        purpose: "job_filled",
        jobId,
        contractorId,
        client: supabase,
      });
    }

    // And the administrators who need to know the job is covered.
    const { data: admins } = await supabase
      .from("profiles")
      .select("id, phone")
      .eq("role", "admin")
      .eq("is_active", true);

    for (const admin of (admins ?? []) as Array<{ id: string; phone: string | null }>) {
      if (!admin.phone) continue;
      await sendSms({
        to: admin.phone,
        body: templates.adminAcceptedSms(job, winner?.full_name ?? "A contractor"),
        purpose: "admin_job_accepted",
        jobId,
        contractorId: winnerContractorId,
        client: supabase,
      });
    }
  } catch (error) {
    // Logged, not propagated -- see the note above.
    console.error("notifyAcceptance failed", error);
  }
}

/** Close expired dispatch rounds. Invoked by the scheduled sweep. */
export async function expireStaleOffers(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("expire_stale_offers");
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}
