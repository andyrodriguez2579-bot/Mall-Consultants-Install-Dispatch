import { twilioEnv } from "@/lib/env";
import type { SmsDriver, SmsSendResult } from "./driver";

const TWILIO_API = "https://api.twilio.com/2010-04-01";
const TIMEOUT_MS = 10_000;

/**
 * Twilio driver, over the REST API directly.
 *
 * The official SDK is a large dependency for one form POST, and going direct
 * keeps the serverless bundle small -- which matters on Vercel, where this runs
 * inside a request.
 */
export const twilioDriver: SmsDriver = {
  name: "twilio",

  async send({ to, body }): Promise<SmsSendResult> {
    const env = twilioEnv();

    const params = new URLSearchParams({ To: to, Body: body });
    // A Messaging Service handles number pooling and compliance; prefer it when
    // configured, and fall back to a single sending number.
    if (env.TWILIO_MESSAGING_SERVICE_SID) {
      params.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
    } else if (env.TWILIO_FROM_NUMBER) {
      params.set("From", env.TWILIO_FROM_NUMBER);
    }

    const auth = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        `${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
          signal: controller.signal,
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        sid?: string;
        status?: string;
        message?: string;
        code?: number;
      };

      if (!response.ok) {
        return {
          ok: false,
          status: "failed",
          // Twilio's own error text is far more actionable than a status code.
          error: payload.message
            ? `Twilio ${payload.code ?? response.status}: ${payload.message}`
            : `Twilio returned HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        // Twilio reports 'queued' or 'accepted' synchronously; delivery is
        // confirmed later via the status webhook.
        status: payload.status === "delivered" ? "delivered" : "sent",
        providerSid: payload.sid ?? null,
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        status: "failed",
        error: aborted
          ? `Twilio request timed out after ${TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : "Unknown Twilio error",
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
