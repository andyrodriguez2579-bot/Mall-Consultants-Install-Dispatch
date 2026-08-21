import type { SupabaseClient } from "@supabase/supabase-js";
import { emailDriver } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { devDriver } from "./dev";
import { resendDriver } from "./resend";
import type { EmailAttachment, EmailDriver } from "./driver";

export * as templates from "./templates";
export type { EmailAttachment, EmailDriver, EmailSendResult } from "./driver";

function resolveDriver(): EmailDriver {
  return emailDriver() === "resend" ? resendDriver : devDriver;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  purpose: string;
  profileId?: string | null;
  jobId?: string | null;
  attachments?: EmailAttachment[];
  client?: SupabaseClient;
}

export interface SendEmailOutcome {
  ok: boolean;
  messageId: string | null;
  error?: string;
}

/** Shape only. Whether an address accepts mail is the provider's answer. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Record an outbound email, hand it to the active driver, record the outcome.
 *
 * Written before the provider call, exactly as sendSms does, so a crash
 * mid-send still leaves evidence that a message was attempted. Never throws:
 * the caller is usually a sign-in request that must answer identically whether
 * or not anything was sent.
 */
export async function sendEmail({
  to,
  subject,
  body,
  purpose,
  profileId = null,
  jobId = null,
  attachments,
  client,
}: SendEmailInput): Promise<SendEmailOutcome> {
  const supabase = client ?? createAdminClient();
  const driver = resolveDriver();

  if (!ADDRESS.test(to)) {
    return { ok: false, messageId: null, error: `Invalid destination address: ${to}` };
  }

  const { data: message, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      to_email: to,
      subject,
      body,
      provider: driver.name,
      status: "queued",
      purpose,
      profile_id: profileId,
      job_id: jobId,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !message) {
    return {
      ok: false,
      messageId: null,
      error: insertError?.message ?? "Could not record outbound email",
    };
  }

  const result = await driver.send({ to, subject, body, attachments });

  await supabase
    .from("email_messages")
    .update({
      status: result.status,
      provider_id: result.providerId ?? null,
      error: result.error ?? null,
    })
    .eq("id", message.id);

  return { ok: result.ok, messageId: message.id, error: result.error };
}
