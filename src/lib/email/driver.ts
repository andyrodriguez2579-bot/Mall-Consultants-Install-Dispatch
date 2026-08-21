import type { EmailStatus } from "@/lib/types";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
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
