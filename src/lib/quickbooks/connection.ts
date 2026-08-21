import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshQuickbooksTokens, revokeQuickbooksToken, type QuickbooksTokens } from "./client";

/**
 * The one stored connection to Mall Consultants' QuickBooks company.
 *
 * Always read and written through the service-role client -- the table has
 * no policy granting `authenticated` anything, so a normal request-scoped
 * client would see nothing here regardless of who is signed in.
 */

export interface QuickbooksConnection {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

interface ConnectionRow {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
}

function fromRow(row: ConnectionRow): QuickbooksConnection {
  return {
    realmId: row.realm_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenExpiresAt: row.refresh_token_expires_at,
  };
}

export async function saveQuickbooksConnection(
  admin: SupabaseClient,
  realmId: string,
  tokens: QuickbooksTokens,
  /** Only set on the initial connect -- a token refresh updates no one's name. */
  connectedBy?: string,
): Promise<void> {
  await admin.from("quickbooks_connection").upsert(
    {
      id: true,
      realm_id: realmId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      access_token_expires_at: tokens.accessTokenExpiresAt,
      refresh_token_expires_at: tokens.refreshTokenExpiresAt,
      ...(connectedBy ? { connected_by: connectedBy, connected_at: new Date().toISOString() } : {}),
    },
    { onConflict: "id" },
  );
}

export async function getQuickbooksConnection(
  admin: SupabaseClient,
): Promise<QuickbooksConnection | null> {
  const { data } = await admin
    .from("quickbooks_connection")
    .select("*")
    .eq("id", true)
    .maybeSingle<ConnectionRow>();
  return data ? fromRow(data) : null;
}

/**
 * A connection with an access token good for at least the next call.
 *
 * Refreshes and persists the new tokens when the access token is stale --
 * QuickBooks access tokens last an hour, and nothing calling this should have
 * to know that or handle a 401 to find out.
 */
export async function getValidQuickbooksConnection(
  admin: SupabaseClient,
): Promise<QuickbooksConnection | null> {
  const connection = await getQuickbooksConnection(admin);
  if (!connection) return null;

  if (new Date(connection.accessTokenExpiresAt).getTime() > Date.now()) {
    return connection;
  }

  if (new Date(connection.refreshTokenExpiresAt).getTime() <= Date.now()) {
    // The refresh token itself has expired -- reconnecting is the only way
    // forward, and that is a person clicking "Connect" again, not something
    // this function can do on its own.
    return null;
  }

  const refreshed = await refreshQuickbooksTokens(connection.refreshToken);
  await saveQuickbooksConnection(admin, connection.realmId, refreshed);
  return { realmId: connection.realmId, ...refreshed };
}

export async function clearQuickbooksConnection(admin: SupabaseClient): Promise<void> {
  const connection = await getQuickbooksConnection(admin);
  if (connection) {
    await revokeQuickbooksToken(connection.refreshToken).catch(() => {});
  }
  await admin.from("quickbooks_connection").delete().eq("id", true);
}
