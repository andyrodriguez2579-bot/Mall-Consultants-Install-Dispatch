import { timingSafeEqual } from "node:crypto";
import { automationApiKey } from "@/lib/env";

/**
 * Authenticate a call from the automation workflow.
 *
 * Compared in constant time. A plain `===` on a secret leaks its length and
 * then its prefix, one byte of timing at a time, to anyone able to call the
 * endpoint repeatedly -- which is precisely who this is guarding against.
 *
 * Returns a reason rather than throwing, so the route can answer 401 without a
 * stack trace reaching the caller.
 */
export function authorizeAutomation(
  request: Request,
): { ok: true } | { ok: false; reason: string } {
  let expected: string;
  try {
    expected = automationApiKey();
  } catch {
    // Misconfiguration, not a bad caller. Never fall open.
    return { ok: false, reason: "Automation is not configured on this server." };
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!presented) return { ok: false, reason: "Missing bearer token." };

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal; compare lengths first and still run the comparison.
  if (a.length !== b.length) return { ok: false, reason: "Invalid token." };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "Invalid token." };

  return { ok: true };
}
