import type { EmailStatus } from "@/lib/types";

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSendResult {
  ok: boolean;
  status: EmailStatus;
  providerId?: string | null;
  error?: string;
}

export interface EmailDriver {
  name: "dev" | "resend";
  send(payload: EmailPayload): Promise<EmailSendResult>;
}
