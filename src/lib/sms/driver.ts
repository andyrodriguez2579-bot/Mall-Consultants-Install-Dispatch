import type { SmsStatus } from "@/lib/types";

export interface SmsPayload {
  to: string;
  body: string;
}

export interface SmsSendResult {
  ok: boolean;
  status: SmsStatus;
  providerSid?: string | null;
  error?: string;
}

export interface SmsDriver {
  name: "dev" | "twilio";
  send(payload: SmsPayload): Promise<SmsSendResult>;
}
