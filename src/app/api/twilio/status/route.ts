import { createHmac, timingSafeEqual } from "node:crypto";
import { appBaseUrl, smsDriver, twilioEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SmsStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Twilio delivery-status webhook.
 *
 * Twilio reports 'sent' synchronously and confirms handset delivery minutes
 * later, so without this the admin message log could only ever say "handed to
 * the carrier". Configure the URL as the StatusCallback on the Messaging
 * Service or the sending number.
 */

const STATUS_MAP: Record<string, SmsStatus> = {
  queued: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  undelivered: "undelivered",
  failed: "failed",
};

/**
 * Validate Twilio's request signature.
 *
 * The scheme is HMAC-SHA1 over the full URL with every POST parameter appended
 * in sorted key order. Without this check, anyone who found the endpoint could
 * rewrite delivery history.
 */
function isValidSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
  authToken: string,
): boolean {
  if (!signature) return false;

  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  const expected = createHmac("sha1", authToken).update(payload, "utf8").digest("base64");

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  // Nothing real is sent in development, so nothing real can report back.
  if (smsDriver() !== "twilio") {
    return Response.json({ ok: false, reason: "SMS driver is not Twilio" }, { status: 400 });
  }

  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body).entries());

  const { TWILIO_AUTH_TOKEN } = twilioEnv();
  // Twilio signs the URL it was configured with, which is the public one --
  // not whatever host header reached this process behind a proxy.
  const callbackUrl = `${appBaseUrl()}/api/twilio/status`;

  if (
    !isValidSignature(
      request.headers.get("x-twilio-signature"),
      callbackUrl,
      params,
      TWILIO_AUTH_TOKEN,
    )
  ) {
    return Response.json({ ok: false, reason: "Invalid signature" }, { status: 403 });
  }

  const sid = params.MessageSid ?? params.SmsSid;
  const rawStatus = params.MessageStatus ?? params.SmsStatus;
  if (!sid || !rawStatus) {
    return Response.json({ ok: false, reason: "Missing SID or status" }, { status: 400 });
  }

  const status = STATUS_MAP[rawStatus];
  if (!status) return Response.json({ ok: true, ignored: rawStatus });

  const supabase = createAdminClient();

  const { data: message } = await supabase
    .from("sms_messages")
    .update({
      status,
      error: params.ErrorMessage ?? params.ErrorCode ?? null,
    })
    .eq("provider_sid", sid)
    .select("id")
    .maybeSingle<{ id: string }>();

  // Mirror delivery onto the offer, so the dispatch view can distinguish
  // "delivered to the handset" from "accepted by the carrier".
  if (message && (status === "delivered" || status === "failed" || status === "undelivered")) {
    await supabase
      .from("job_offers")
      .update(
        status === "delivered"
          ? { status: "delivered", delivered_at: new Date().toISOString() }
          : { status: "failed", failure_reason: params.ErrorMessage ?? "Carrier could not deliver" },
      )
      .eq("sms_message_id", message.id)
      // Never walk a decided offer backwards.
      .in("status", ["pending", "sent"]);
  }

  return Response.json({ ok: true });
}
