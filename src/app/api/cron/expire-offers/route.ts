import { cronSecret } from "@/lib/env";
import { expireStaleOffers } from "@/lib/dispatch";

export const dynamic = "force-dynamic";

/**
 * Scheduled sweep that closes dispatch rounds whose window has elapsed and
 * marks the job 'unfilled' so an administrator can re-offer it.
 *
 * Offers also expire lazily -- accept_job_offer checks the deadline on every
 * attempt, so a missed sweep can never let a stale offer be accepted. This job
 * exists to keep the dashboard honest, not to enforce the rule.
 *
 * Wire it up in vercel.json, or hit it from any scheduler with the shared
 * secret in the Authorization header.
 */
export async function GET(request: Request) {
  const secret = cronSecret();

  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Refuse to run unauthenticated in production rather than exposing an
    // endpoint that mutates job state to anyone who finds the URL.
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  try {
    const expired = await expireStaleOffers();
    return Response.json({ ok: true, expired });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Sweep failed" },
      { status: 500 },
    );
  }
}
