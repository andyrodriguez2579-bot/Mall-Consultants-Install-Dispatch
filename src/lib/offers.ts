import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, looksLikeToken } from "@/lib/tokens";
import type { Job, JobOffer, Profile, Skill } from "@/lib/types";

/**
 * Reading a dispatch offer from the secure token in its link.
 *
 * The token is the bearer credential, so lookups run through the service-role
 * client -- there is no session yet when a contractor first taps the link from
 * their messages app. Everything returned here is scoped to that single offer.
 */

export interface OfferView {
  offer: JobOffer;
  job: Job;
  contractor: Pick<Profile, "id" | "full_name" | "phone">;
  requiredSkills: Skill[];
  /** True when the contractor holds every skill the job requires. */
  qualified: boolean;
  /** True when this offer's window has closed. */
  expired: boolean;
  /** True when someone else already won the job. */
  filled: boolean;
}

export async function loadOfferByToken(token: string): Promise<OfferView | null> {
  if (!looksLikeToken(token)) return null;

  const supabase = createAdminClient();

  const { data: offer } = await supabase
    .from("job_offers")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle<JobOffer>();

  if (!offer) return null;

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", offer.job_id)
    .maybeSingle<Job>();

  if (!job) return null;

  const { data: contractor } = await supabase
    .from("profiles")
    .select("id, full_name, phone")
    .eq("id", offer.contractor_id)
    .maybeSingle<Pick<Profile, "id" | "full_name" | "phone">>();

  if (!contractor) return null;

  const { data: skillRows } = await supabase
    .from("job_skills")
    .select("skills(id, slug, name, description, is_active)")
    .eq("job_id", job.id);

  const requiredSkills = ((skillRows ?? []) as unknown as Array<{ skills: Skill }>)
    .map((r) => r.skills)
    .filter(Boolean);

  const { data: heldRows } = await supabase
    .from("contractor_skills")
    .select("skill_id")
    .eq("contractor_id", offer.contractor_id);

  const held = new Set((heldRows ?? []).map((r) => (r as { skill_id: string }).skill_id));
  const qualified = requiredSkills.every((s) => held.has(s.id));

  const expired =
    new Date(offer.expires_at).getTime() <= Date.now() || offer.status === "expired";

  const filled =
    offer.status === "filled" ||
    (job.assigned_contractor_id !== null &&
      job.assigned_contractor_id !== offer.contractor_id);

  return { offer, job, contractor, requiredSkills, qualified, expired, filled };
}

/**
 * Record that the contractor opened the link.
 *
 * Only advances 'pending' / 'sent' / 'delivered' to 'viewed', so it can never
 * walk a decided offer backwards.
 */
export async function markOfferViewed(offerId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("job_offers")
    .update({ status: "viewed", viewed_at: new Date().toISOString() })
    .eq("id", offerId)
    .in("status", ["pending", "sent", "delivered"]);
}
