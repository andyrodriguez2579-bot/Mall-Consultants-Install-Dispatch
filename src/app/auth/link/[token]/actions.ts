"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth";
import { establishSession, redeemSignInLink } from "@/lib/passwordless";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export interface CompleteSignInState {
  error?: string;
}

/**
 * Spend the token and start the session.
 *
 * This is the only place a sign-in token is consumed, and it is reachable only
 * by submitting the form -- which is the entire point. The page that shows the
 * button is a GET, and GETs to these URLs are made by machines in transit:
 * message previewers, mail scanners, safe-link rewriters. Consuming on render
 * meant the link was routinely spent before its owner touched it.
 */
export async function completeSignIn(
  _prev: CompleteSignInState,
  formData: FormData,
): Promise<CompleteSignInState> {
  const token = formData.get("token");
  if (typeof token !== "string" || token.length < 10) {
    return { error: "This sign-in link is not valid. Request a new one." };
  }

  const redemption = await redeemSignInLink(token);

  if (!redemption.ok) {
    return {
      error:
        redemption.reason === "expired"
          ? "This sign-in link has expired. Links are good for 15 minutes."
          : redemption.reason === "used"
            ? "This sign-in link has already been used. Request a new one."
            : "This sign-in link is not valid. Request a new one.",
    };
  }

  const established = await establishSession(redemption.profileId);
  if (!established) {
    return { error: "We could not sign you in just now. Please request a new link." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", redemption.profileId)
    .maybeSingle<Pick<Profile, "role">>();

  // redirect() signals by throwing, so it sits last and nothing may follow it.
  redirect(homePathFor(profile?.role ?? "contractor"));
}
