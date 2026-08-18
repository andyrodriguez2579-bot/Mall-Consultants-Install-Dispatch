"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface ClaimState {
  error?: string;
  claimedJobId?: string;
}

/**
 * Claim a job off the open board.
 *
 * The decision is made entirely inside claim_board_job: it takes a row lock,
 * re-checks that the job is posted, unclaimed and within this contractor's
 * certifications, and settles the race with a guarded update. Doing any of that
 * here would be checking a fact and then acting on it a moment later, which is
 * exactly the window two simultaneous taps need.
 *
 * The contractor is not passed in. The function reads auth.uid() from the
 * caller's own session, so a request cannot claim work in somebody else's name.
 */
export async function claimBoardJob(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  await requireRole("contractor");

  const jobId = formData.get("job_id");
  if (typeof jobId !== "string") return { error: "That job could not be found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("claim_board_job", { p_job_id: jobId })
    .single<{ result: string; job_id: string; message: string }>();

  if (error) return { error: error.message };
  if (!data) return { error: "That job could not be claimed." };

  if (data.result !== "accepted") return { error: data.message };

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${data.job_id}`);
  return { claimedJobId: data.job_id };
}
