import { appBaseUrl } from "@/lib/env";
import { sendSms, templates } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/tokens";
import type { Profile } from "@/lib/types";

/**
 * Passwordless sign-in for contractors.
 *
 * The design goal is that tapping a link from a text message produces a *real*
 * Supabase session, not a bespoke one. That matters because row-level security
 * keys off the JWT: if contractors browsed under a hand-rolled cookie, every
 * query would have to run as the service role and RLS would protect nothing.
 *
 * So the exchange is two-step. Our own token (hashed in login_tokens or
 * job_offers) is verified server-side, and only then does the server mint a
 * genuine Supabase session for that user via the admin API. From that point on
 * the contractor's requests are ordinary authenticated requests.
 */

const SIGN_IN_TTL_MINUTES = 15;

/**
 * Establish a Supabase session for a profile that has already been
 * authenticated by some other means.
 *
 * Callers MUST have verified a token before calling this -- it performs no
 * authorization of its own.
 */
export async function establishSession(profileId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: authUser, error: lookupError } =
    await admin.auth.admin.getUserById(profileId);

  if (lookupError || !authUser?.user?.email) {
    console.error("establishSession: no auth user or email", lookupError);
    return false;
  }

  // generateLink produces a one-time hashed token without emailing anything.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });

  if (linkError || !link?.properties?.hashed_token) {
    console.error("establishSession: could not generate link", linkError);
    return false;
  }

  // Redeeming it on the cookie-bound server client writes the session cookies.
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });

  if (verifyError) {
    console.error("establishSession: verifyOtp failed", verifyError);
    return false;
  }

  return true;
}

/**
 * Text a contractor a fresh sign-in link.
 *
 * Always reports success. Telling an unauthenticated caller whether a phone
 * number is registered would turn this into a roster oracle.
 */
export async function requestSignInLink(phone: string): Promise<void> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active")
    .eq("phone", phone)
    .eq("is_active", true)
    .maybeSingle<Pick<Profile, "id" | "full_name" | "phone" | "role" | "is_active">>();

  if (!profile) return;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SIGN_IN_TTL_MINUTES * 60_000).toISOString();

  const { error } = await admin.from("login_tokens").insert({
    profile_id: profile.id,
    token_hash: hashToken(token),
    purpose: "magic_link",
    expires_at: expiresAt,
  });

  if (error) {
    console.error("requestSignInLink: could not store token", error);
    return;
  }

  await sendSms({
    to: phone,
    body: templates.signInSms(`${appBaseUrl()}/auth/link/${token}`),
    purpose: "sign_in_link",
    contractorId: profile.role === "contractor" ? profile.id : null,
    client: admin,
  });
}

export type LinkRedemption =
  | { ok: true; profileId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Redeem a sign-in token. Single use: the row is claimed with a conditional
 * update, so two taps of the same link cannot both succeed.
 */
export async function redeemSignInLink(token: string): Promise<LinkRedemption> {
  const admin = createAdminClient();
  const tokenHash = hashToken(token);

  const { data: row } = await admin
    .from("login_tokens")
    .select("id, profile_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<{
      id: string;
      profile_id: string;
      expires_at: string;
      used_at: string | null;
    }>();

  if (!row) return { ok: false, reason: "invalid" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Conditional claim -- `used_at is null` makes this the single-use gate.
  const { data: claimed } = await admin
    .from("login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (!claimed) return { ok: false, reason: "used" };

  return { ok: true, profileId: row.profile_id };
}
