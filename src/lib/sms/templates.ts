import { SMS_SENDER_LABEL } from "@/lib/branding";
import { formatMoney } from "@/lib/format";
import type { Job } from "@/lib/types";

/**
 * SMS bodies.
 *
 * Two constraints shape everything here. A GSM-7 segment is 160 characters and
 * every extra segment is billed, so messages stay tight. And the link is the
 * whole point of the message -- it goes last, where a phone will linkify it
 * cleanly without trailing punctuation.
 */

export interface OfferSmsInput {
  job: Pick<
    Job,
    "job_number" | "title" | "city" | "state_code" | "contractor_pay_cents" | "currency" | "scheduled_start"
  >;
  link: string;
  expiresInHours: number;
}

export function offerSms({ job, link, expiresInHours }: OfferSmsInput): string {
  const pay = formatMoney(job.contractor_pay_cents, job.currency);
  const when = job.scheduled_start
    ? new Date(job.scheduled_start).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "TBD";

  return [
    `${SMS_SENDER_LABEL}: new job ${job.job_number}`,
    `${job.title}`,
    `${job.city}, ${job.state_code} · ${when} · ${pay}`,
    `First to accept gets it. Expires in ${expiresInHours}h.`,
    link,
  ].join("\n");
}

export function assignedSms(job: Pick<Job, "job_number" | "title">, link: string): string {
  return [
    `${SMS_SENDER_LABEL}: you have job ${job.job_number}`,
    job.title,
    `Details and check-in:`,
    link,
  ].join("\n");
}

export function filledSms(job: Pick<Job, "job_number">): string {
  return `${SMS_SENDER_LABEL}: job ${job.job_number} has been filled. Thanks for looking -- we'll send the next one.`;
}

export function signInSms(link: string): string {
  return [
    `${SMS_SENDER_LABEL}: your sign-in link (valid 15 min, single use)`,
    link,
  ].join("\n");
}

export function reworkSms(job: Pick<Job, "job_number">, link: string): string {
  return [
    `${SMS_SENDER_LABEL}: job ${job.job_number} needs rework`,
    `Review the notes and resubmit:`,
    link,
  ].join("\n");
}

export function approvedSms(job: Pick<Job, "job_number" | "contractor_pay_cents" | "currency">): string {
  return `${SMS_SENDER_LABEL}: job ${job.job_number} approved. ${formatMoney(
    job.contractor_pay_cents,
    job.currency,
  )} is queued for payment.`;
}

export function paidSms(
  job: Pick<Job, "job_number" | "contractor_pay_cents" | "currency">,
  reference: string | null,
): string {
  const ref = reference ? ` Ref ${reference}.` : "";
  return `${SMS_SENDER_LABEL}: payment sent for job ${job.job_number} — ${formatMoney(
    job.contractor_pay_cents,
    job.currency,
  )}.${ref}`;
}

/** Notify an admin that a dispatched job found a taker. */
export function adminAcceptedSms(
  job: Pick<Job, "job_number">,
  contractorName: string,
): string {
  return `${SMS_SENDER_LABEL}: ${contractorName} accepted job ${job.job_number}.`;
}
