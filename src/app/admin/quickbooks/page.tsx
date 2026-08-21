import { Card, CardHeader, ErrorBanner, SuccessBanner, buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getQuickbooksConnection } from "@/lib/quickbooks/connection";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The one QuickBooks connection this app has, and the button to make or
 * remake it.
 *
 * This is also Intuit's own "Launch URL" for the app -- where a person lands
 * after authenticating -- which is why it exists as a page rather than only
 * as state shown inline on an invoice.
 */
export default async function QuickbooksStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const admin = createAdminClient();
  const connection = await getQuickbooksConnection(admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">QuickBooks</h1>
        <p className="mt-1 text-sm text-slate-600">
          Mirrors sent invoices into QuickBooks for Mall Consultants&apos; own
          records. Never sent to JG Installations or the customer.
        </p>
      </div>

      {params.error ? <ErrorBanner>{params.error}</ErrorBanner> : null}
      {params.connected ? <SuccessBanner>Connected.</SuccessBanner> : null}
      {params.disconnected ? <SuccessBanner>Disconnected.</SuccessBanner> : null}

      <Card>
        <CardHeader title="Connection" />
        <div className="space-y-3 p-4 sm:p-5">
          {connection ? (
            <>
              <p className="text-sm text-slate-700">
                Connected to QuickBooks company <span className="font-mono">{connection.realmId}</span>.
              </p>
              <p className="text-xs text-slate-500">
                Access token valid until {formatDateTime(connection.accessTokenExpiresAt)} (refreshed
                automatically). Refresh token valid until{" "}
                {formatDateTime(connection.refreshTokenExpiresAt)} -- reconnect before then or the
                connection will need to be made again from scratch.
              </p>
              <a href="/api/quickbooks/disconnect" className={buttonClass("secondary")}>
                Disconnect
              </a>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">Not connected.</p>
              <a href="/api/quickbooks/connect" className={buttonClass("primary")}>
                Connect to QuickBooks
              </a>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
