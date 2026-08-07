import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secure link tokens.
 *
 * Offer links and passwordless sign-in links are both bearer credentials
 * delivered over SMS. The rules that follow from that:
 *
 *   - 256 bits of entropy, so a link is not guessable and job URLs are never
 *     enumerable.
 *   - Only the SHA-256 digest is persisted. Someone who reads the database
 *     cannot reconstruct a working link.
 *   - base64url encoding, because the token has to survive being pasted into
 *     an SMS, tapped from a native messages app, and placed in a URL path.
 */

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison, for anywhere a digest is compared in application code. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Reject anything that is not plausibly one of our tokens before it reaches the
 * database, so malformed input costs a regex rather than a query.
 */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,90}$/.test(value);
}
