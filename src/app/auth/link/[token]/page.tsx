import { redirect } from "next/navigation";
import { ORG_NAME } from "@/lib/branding";
import { establishSession, redeemSignInLink } from "@/lib/passwordless";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErrorBanner } from "@/components/ui";
import { homePathFor } from "@/lib/auth";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  invalid: "This sign-in link is not valid.",
  expired: "This sign-in link has expired. Links are good for 15 minutes.",
  used: "This sign-in link has already been used. Request a new one.",
};

/** Redeems a single-use SMS sign-in token and starts a session. */
export default async function AuthLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const redemption = await redeemSignInLink(token);

  if (!redemption.ok) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-blue-700">
          {ORG_NAME}
        </p>
        <ErrorBanner>
          {REASONS[redemption.reason] ?? REASONS.invalid}{" "}
          <a href="/sign-in" className="font-semibold underline underline-offset-2">
            Request a new link
          </a>
          .
        </ErrorBanner>
      </main>
    );
  }

  const established = await establishSession(redemption.profileId);
  if (!established) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <ErrorBanner>
          We could not sign you in just now. Please{" "}
          <a href="/sign-in" className="font-semibold underline underline-offset-2">
            request a new link
          </a>
          .
        </ErrorBanner>
      </main>
    );
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", redemption.profileId)
    .maybeSingle<Pick<Profile, "role">>();

  redirect(homePathFor(profile?.role ?? "contractor"));
}
