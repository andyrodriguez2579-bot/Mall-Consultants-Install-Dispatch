import type { SupabaseClient } from "@supabase/supabase-js";
import { smsDriver } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { devDriver } from "./dev";
import { twilioDriver } from "./twilio";
import type { SmsDriver } from "./driver";

export * as templates from "./templates";
export type { SmsDriver, SmsSendResult } from "./driver";

function resolveDriver(): SmsDriver {
  return smsDriver() === "twilio" ? twilioDriver : devDriver;
}

export interface SendSmsInput {
  to: string;
  body: string;
  purpose: string;
  jobId?: string | null;
  contractorId?: string | null;
  /** Reuse an existing service-role client when sending in a batch. */
  client?: SupabaseClient;
}

export interface SendSmsOutcome {
  ok: boolean;
  messageId: string | null;
  providerSid: string | null;
  error?: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Persist an outbound message, hand it to the active driver, and record the
 * result.
 *
 * The row is written *before* the provider call so a crash mid-send still
 * leaves evidence that a message was attempted. This never throws: a dispatch
 * to twenty contractors must not be abandoned because one number is bad, so
 * failures are returned and recorded per recipient.
 */
export async function sendSms({
  to,
  body,
  purpose,
  jobId = null,
  contractorId = null,
  client,
}: SendSmsInput): Promise<SendSmsOutcome> {
  const supabase = client ?? createAdminClient();
  const driver = resolveDriver();

  if (!E164.test(to)) {
    // Recorded as a failure against the contractor rather than silently dropped,
    // so an admin can see why someone was never reached.
    const { data } = await supabase
      .from("sms_messages")
      .insert({
        to_phone: "+10000000000",
        body,
        provider: driver.name,
        status: "failed",
        error: `Invalid destination number: ${to}`,
        purpose,
        job_id: jobId,
        contractor_id: contractorId,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    return {
      ok: false,
      messageId: data?.id ?? null,
      providerSid: null,
      error: `Invalid destination number: ${to}`,
    };
  }

  const { data: message, error: insertError } = await supabase
    .from("sms_messages")
    .insert({
      to_phone: to,
      body,
      provider: driver.name,
      status: "queued",
      purpose,
      job_id: jobId,
      contractor_id: contractorId,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !message) {
    return {
      ok: false,
      messageId: null,
      providerSid: null,
      error: insertError?.message ?? "Could not record outbound message",
    };
  }

  const result = await driver.send({ to, body });

  await supabase
    .from("sms_messages")
    .update({
      status: result.status,
      provider_sid: result.providerSid ?? null,
      error: result.error ?? null,
    })
    .eq("id", message.id);

  return {
    ok: result.ok,
    messageId: message.id,
    providerSid: result.providerSid ?? null,
    error: result.error,
  };
}
