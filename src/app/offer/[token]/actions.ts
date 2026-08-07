"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { notifyAcceptance } from "@/lib/dispatch";
import { loadOfferByToken } from "@/lib/offers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hashToken, looksLikeToken } from "@/lib/tokens";
import type { AcceptResult, OfferActionResult } from "@/lib/types";
import { questionSchema } from "@/lib/validation";

export interface OfferActionState {
  result?: AcceptResult;
  message?: string;
  error?: string;
  questionSent?: boolean;
}

/**
 * Choose the client the acceptance RPC runs under.
 *
 * When the contractor has a session -- the normal case, since visiting the
 * offer page establishes one -- the call goes through their own authenticated
 * client so the function's auth.uid() ownership check applies as well as the
 * token check. Without a session the token alone is the credential, and the
 * service-role client is used; the function still re-validates everything.
 */
async function clientForOffer(contractorId: string) {
  const user = await getSessionUser();
  if (user && user.id === contractorId) {
    return await createClient();
  }
  return createAdminClient();
}

export async function acceptOffer(
  _prev: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const token = formData.get("token");
  if (typeof token !== "string" || !looksLikeToken(token)) {
    return { error: "This link is not valid." };
  }

  const view = await loadOfferByToken(token);
  if (!view) return { error: "This link is not valid." };

  const supabase = await clientForOffer(view.offer.contractor_id);

  const { data, error } = await supabase.rpc("accept_job_offer", {
    p_token_hash: hashToken(token),
  });

  if (error) {
    return { error: "We could not process that just now. Please try again." };
  }

  // The function returns a single row.
  const outcome = (Array.isArray(data) ? data[0] : data) as OfferActionResult | undefined;
  if (!outcome) return { error: "We could not process that just now. Please try again." };

  if (outcome.result === "accepted" && outcome.job_id) {
    // Fan-out is best-effort and must not affect the acceptance itself.
    await notifyAcceptance({
      jobId: outcome.job_id,
      winnerContractorId: view.offer.contractor_id,
    });
  }

  revalidatePath(`/offer/${token}`);
  return { result: outcome.result, message: outcome.message };
}

export async function passOffer(
  _prev: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const token = formData.get("token");
  if (typeof token !== "string" || !looksLikeToken(token)) {
    return { error: "This link is not valid." };
  }

  const view = await loadOfferByToken(token);
  if (!view) return { error: "This link is not valid." };

  const supabase = await clientForOffer(view.offer.contractor_id);
  const { data, error } = await supabase.rpc("pass_job_offer", {
    p_token_hash: hashToken(token),
  });

  if (error) return { error: "We could not record that. Please try again." };

  const outcome = (Array.isArray(data) ? data[0] : data) as OfferActionResult | undefined;
  revalidatePath(`/offer/${token}`);
  return { result: outcome?.result, message: outcome?.message };
}

/**
 * Submit a question about an offer without accepting or passing. The offer
 * stays live -- asking must never cost a contractor the job.
 */
export async function askQuestion(
  _prev: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const parsed = questionSchema.safeParse({
    token: formData.get("token"),
    question: formData.get("question"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your question." };
  }

  const view = await loadOfferByToken(parsed.data.token);
  if (!view) return { error: "This link is not valid." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("job_offers")
    .update({
      question: parsed.data.question,
      question_at: new Date().toISOString(),
    })
    .eq("id", view.offer.id);

  if (error) return { error: "We could not send that question. Please try again." };

  await admin.rpc("write_audit", {
    p_entity_type: "job",
    p_entity_id: view.job.id,
    p_action: "offer.question_asked",
    p_detail: { offer_id: view.offer.id, question: parsed.data.question },
    p_actor_id: view.offer.contractor_id,
  });

  revalidatePath(`/offer/${parsed.data.token}`);
  return { questionSent: true };
}
