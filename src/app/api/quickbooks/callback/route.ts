import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { exchangeCodeForTokens } from "@/lib/quickbooks/client";
import { saveQuickbooksConnection } from "@/lib/quickbooks/connection";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "qbo_oauth_state";

/**
 * Where Intuit sends the admin's browser back after they approve access.
 *
 * The state check is what stops a crafted link from connecting this app to
 * an attacker's QuickBooks company instead of Mall Consultants' own: only a
 * request carrying the exact value this app itself set in /connect is
 * accepted.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const failure = (reason: string) =>
    Response.redirect(`${appBaseUrl()}/admin/quickbooks?error=${encodeURIComponent(reason)}`);

  if (error) return failure(`QuickBooks declined: ${error}`);
  if (!code || !realmId) return failure("QuickBooks did not return a code and company id.");
  if (!state || !expectedState || state !== expectedState) {
    return failure("The connection request could not be verified. Try connecting again.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const supabase = createAdminClient();
    await saveQuickbooksConnection(supabase, realmId, tokens, admin.id);
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : "Could not complete the connection.");
  }

  return Response.redirect(`${appBaseUrl()}/admin/quickbooks?connected=1`);
}
