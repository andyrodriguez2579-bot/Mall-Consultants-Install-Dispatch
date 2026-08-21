import { appBaseUrl } from "@/lib/env";
import { clearQuickbooksConnection } from "@/lib/quickbooks/connection";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Where QuickBooks sends the user when they disconnect this app from inside
 * QuickBooks itself -- not a request carrying this app's own admin session,
 * which is why this does not call requireAdmin(). There is exactly one
 * connection in this whole application (0026: quickbooks_connection is a
 * singleton), so there is nothing to authorize beyond "clear the one row."
 */
export async function GET() {
  const admin = createAdminClient();
  await clearQuickbooksConnection(admin);
  return Response.redirect(`${appBaseUrl()}/admin/quickbooks?disconnected=1`);
}
