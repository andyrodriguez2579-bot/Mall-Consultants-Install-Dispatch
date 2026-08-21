import { appBaseUrl, quickbooksEnv } from "@/lib/env";

/**
 * The raw HTTP surface of QuickBooks Online -- OAuth and the Accounting API.
 *
 * No SDK, same reasoning as the Resend driver: this is a handful of JSON
 * requests, and a dependency that can create records in the real company file
 * is a larger thing to accept than what it would save.
 *
 * Endpoints come from Intuit's own discovery document rather than being
 * hardcoded, so a URL Intuit rotates does not silently break this app --
 * with a fallback to the last known-good values if the discovery document
 * itself cannot be reached, since a login should not fail over that.
 */

const FALLBACK_ENDPOINTS = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

interface DiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
}

let discoveryCache: { doc: DiscoveryDocument; expiresAt: number } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function discoveryDocument(): Promise<DiscoveryDocument> {
  if (discoveryCache && discoveryCache.expiresAt > Date.now()) return discoveryCache.doc;

  const { QBO_ENVIRONMENT } = quickbooksEnv();
  const url =
    QBO_ENVIRONMENT === "production"
      ? "https://developer.api.intuit.com/.well-known/openid_configuration"
      : "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`discovery document returned ${response.status}`);
    const doc = (await response.json()) as DiscoveryDocument;
    discoveryCache = { doc, expiresAt: Date.now() + DISCOVERY_TTL_MS };
    return doc;
  } catch {
    return FALLBACK_ENDPOINTS;
  }
}

/**
 * A network error or a 5xx is worth one retry -- QuickBooks has brief blips
 * like any API. A 4xx is not: invalid_grant, a bad client secret, or a
 * malformed request will still be exactly as invalid a second later, and
 * retrying it only delays the error a real problem needs to surface.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status < 500 || attempt >= 1) return response;
    } catch (cause) {
      if (attempt >= 1) throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function quickbooksRedirectUri(): Promise<string> {
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
export async function quickbooksAuthorizeUrl(state: string): Promise<string> {
  const { QBO_CLIENT_ID } = quickbooksEnv();
  const { authorization_endpoint } = await discoveryDocument();
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: await quickbooksRedirectUri(),
    state,
  });
  return `${authorization_endpoint}?${params.toString()}`;
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

/**
 * Every failure from Intuit's side carries `intuit_tid` -- their own request
 * id -- attached here rather than dropped, because it is the one thing their
 * support team asks for first when troubleshooting a specific failed call.
 */
export class QuickbooksApiError extends Error {
  readonly intuitTid: string | null;

  constructor(message: string, intuitTid: string | null) {
    super(intuitTid ? `${message} (intuit_tid: ${intuitTid})` : message);
    this.intuitTid = intuitTid;
  }
}

/** Thrown specifically for `invalid_grant` -- a refresh token that is dead and cannot be retried, only replaced by reconnecting. */
export class QuickbooksInvalidGrantError extends QuickbooksApiError {}

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

async function requestTokens(body: URLSearchParams): Promise<QuickbooksTokens> {
  const { token_endpoint } = await discoveryDocument();
  const response = await fetchWithRetry(token_endpoint, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok) {
    const message = payload.error_description ?? payload.error ?? `QuickBooks returned ${response.status}`;
    const intuitTid = response.headers.get("intuit_tid");
    if (payload.error === "invalid_grant") throw new QuickbooksInvalidGrantError(message, intuitTid);
    throw new QuickbooksApiError(message, intuitTid);
  }
  return tokensFromResponse(payload);
}

export async function exchangeCodeForTokens(code: string): Promise<QuickbooksTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: await quickbooksRedirectUri(),
    }),
  );
}

export async function refreshQuickbooksTokens(refreshToken: string): Promise<QuickbooksTokens> {
  return requestTokens(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export async function revokeQuickbooksToken(token: string): Promise<void> {
  const { revocation_endpoint } = await discoveryDocument();
  await fetchWithRetry(revocation_endpoint, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ token }),
  }).catch(() => {});
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
  const response = await fetchWithRetry(`${quickbooksApiBase()}/v3/company/${realmId}/${path}`, {
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
    throw new QuickbooksApiError(message, response.headers.get("intuit_tid"));
  }
  return payload as T;
}
