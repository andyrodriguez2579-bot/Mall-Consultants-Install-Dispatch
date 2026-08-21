import { appBaseUrl, quickbooksEnv } from "@/lib/env";

/**
 * The raw HTTP surface of QuickBooks Online -- OAuth and the Accounting API.
 *
 * No SDK, same reasoning as the Resend driver: this is a handful of JSON
 * requests, and a dependency that can create records in the real company file
 * is a larger thing to accept than what it would save.
 */

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export function quickbooksRedirectUri(): string {
  return `${appBaseUrl()}/api/quickbooks/callback`;
}

/** Sandbox and production are entirely separate companies at separate hosts. */
export function quickbooksApiBase(): string {
  const { QBO_ENVIRONMENT } = quickbooksEnv();
  return QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function basicAuthHeader(): string {
  const { QBO_CLIENT_ID, QBO_CLIENT_SECRET } = quickbooksEnv();
  return `Basic ${Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64")}`;
}

/** Where the admin's browser is sent to approve access. `state` is checked back on the callback, as the CSRF guard. */
export function quickbooksAuthorizeUrl(state: string): string {
  const { QBO_CLIENT_ID } = quickbooksEnv();
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: quickbooksRedirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface QuickbooksTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  error?: string;
  error_description?: string;
}

function tokensFromResponse(payload: TokenResponse): QuickbooksTokens {
  const now = Date.now();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    // A minute of slack so a token is never used right at the edge of expiry.
    accessTokenExpiresAt: new Date(now + (payload.expires_in - 60) * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + (payload.x_refresh_token_expires_in - 60) * 1000).toISOString(),
  };
}

export async function exchangeCodeForTokens(code: string): Promise<QuickbooksTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: quickbooksRedirectUri(),
    }),
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? `QuickBooks returned ${response.status}`);
  }
  return tokensFromResponse(payload);
}

export async function refreshQuickbooksTokens(refreshToken: string): Promise<QuickbooksTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? `QuickBooks returned ${response.status}`);
  }
  return tokensFromResponse(payload);
}

export async function revokeQuickbooksToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ token }),
  });
  // Best-effort: whether or not Intuit accepts the revoke call, the stored
  // connection is deleted by the caller regardless, and a token nobody has
  // any longer is no longer a live credential from this app's side.
}

/** One authenticated call against the Accounting API for a connected realm. */
export async function quickbooksApiRequest<T>(
  realmId: string,
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${quickbooksApiBase()}/v3/company/${realmId}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload as { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } })?.Fault
        ?.Error?.[0]?.Detail ?? `QuickBooks API returned ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
