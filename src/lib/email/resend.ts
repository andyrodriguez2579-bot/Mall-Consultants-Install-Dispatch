import { resendEnv } from "@/lib/env";
import type { EmailDriver, EmailSendResult } from "./driver";

/**
 * Resend, over its HTTP API.
 *
 * No SDK: this is one POST with a JSON body, and a dependency that can send
 * mail on behalf of the business is a larger thing to accept than the twenty
 * lines it would save.
 *
 * Plain text only. These are sign-in links and short operational notices, and
 * a text/plain message is the one shape no client mangles, no image proxy
 * rewrites, and no spam filter marks down for a mismatched HTML part. An
 * attachment -- the JG Installations workbook -- is the one exception: it
 * travels alongside the text body, not instead of it.
 */
export const resendDriver: EmailDriver = {
  name: "resend",

  async send({ to, subject, body, attachments }): Promise<EmailSendResult> {
    const { RESEND_API_KEY, EMAIL_FROM } = resendEnv();

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [to],
          subject,
          text: body,
          ...(attachments && attachments.length > 0
            ? {
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content.toString("base64"),
                })),
              }
            : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { id?: string; message?: string; name?: string }
        | null;

      if (!response.ok) {
        return {
          ok: false,
          status: "failed",
          error: payload?.message ?? `Resend returned ${response.status}`,
        };
      }

      return { ok: true, status: "sent", providerId: payload?.id ?? null };
    } catch (cause) {
      // Never thrown onward: a sign-in request that cannot reach Resend should
      // record why and report the same neutral answer as every other attempt,
      // not surface a network error to whoever typed the address.
      return {
        ok: false,
        status: "failed",
        error: cause instanceof Error ? cause.message : "Could not reach Resend",
      };
    }
  },
};
