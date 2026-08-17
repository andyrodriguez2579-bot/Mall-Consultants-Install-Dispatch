import { ORG_NAME } from "@/lib/branding";
import { inspectSignInLink } from "@/lib/passwordless";
import { SignInButton } from "./sign-in-button";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  invalid: "This sign-in link is not valid.",
  expired: "This sign-in link has expired. Links are good for 15 minutes.",
  used: "This sign-in link has already been used. Request a new one.",
};

/**
 * The landing page for a sign-in link.
 *
 * It deliberately does not sign anyone in. Rendering is a GET, and GETs to this
 * URL are made by machines before its owner ever taps it: messaging apps fetch
 * it to build the preview card that appears under the text, mail providers
 * fetch it to scan for malware. While redemption happened here, the link was
 * reliably spent in transit -- so the contractor's first tap told them, quite
 * accurately, that it had already been used.
 *
 * This reads the token's state without spending it and offers a button. The
 * press is a POST, and none of those machines post.
 */
export default async function AuthLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const state = await inspectSignInLink(token);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-blue-700">
        {ORG_NAME}
      </p>

      {state.ok ? (
        <>
          <h1 className="text-xl font-bold text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600">
            Tap below to sign in to your account. This link can be used once.
          </p>
          <div className="mt-5">
            <SignInButton token={token} />
          </div>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-slate-900">
            This link cannot be used
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {REASONS[state.reason] ?? REASONS.invalid}
          </p>
          <a
            href="/sign-in"
            className="mt-5 inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Request a new link
          </a>
        </>
      )}
    </main>
  );
}
