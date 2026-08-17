import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";

/**
 * Outbound email bodies.
 *
 * Plain text, and no GSM-7 constraint to worry about here -- that limit belongs
 * to SMS, where a stray em dash halves the characters per billed segment. What
 * matters instead is that a sign-in email reads as one a person asked for: the
 * request is named, the expiry is stated, and doing nothing is given as a valid
 * response, because the one who did not ask is exactly the one who needs to
 * know they can ignore it.
 */

export function signInEmail(link: string, expiresInMinutes: number): {
  subject: string;
  body: string;
} {
  return {
    subject: `Your ${ORG_NAME} sign-in link`,
    body: [
      `Someone asked to sign in to ${ORG_NAME} ${PRODUCT_NAME} with this email address.`,
      "",
      "Open this link to sign in:",
      link,
      "",
      `The link works once and expires in ${expiresInMinutes} minutes.`,
      "",
      "If this wasn't you, ignore this email. Nothing has changed on your account.",
      "",
      ORG_NAME,
    ].join("\n"),
  };
}
