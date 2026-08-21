import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { quickbooksAuthorizeUrl } from "@/lib/quickbooks/client";

export const dynamic = "force-dynamic";

/** The state cookie is the CSRF guard: the callback only proceeds if it gets the same value back from Intuit. */
const STATE_COOKIE = "qbo_oauth_state";

export async function GET() {
  await requireAdmin();

  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/quickbooks",
  });

  return Response.redirect(await quickbooksAuthorizeUrl(state));
}
