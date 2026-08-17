import { SMS_SENDER_LABEL } from "@/lib/branding";
import { formatMoney } from "@/lib/format";
import type { Job } from "@/lib/types";

/**
 * SMS bodies.
 *
 * Three constraints shape everything here. A GSM-7 segment is 160 characters and
 * every extra segment is billed, so messages stay tight. And the link is the
 * whole point of the message -- it goes last, where a phone will linkify it
 * cleanly without trailing punctuation.
 *
 * Every character stays inside GSM-7. One character outside it -- an em dash,
 * a middle dot, a curly quote -- re-encodes the entire message as UCS-2, which
 * drops a segment from 160 characters to 70. An offer runs to roughly 200
 * characters, so a single decorative separator turns a two-segment message into
 * three, on every offer, forever.
 *
 * The offer message carries opt-out wording; the rest do not. Carriers expect
 * it discoverable rather than on every message, and an offer is the one a
 * contractor receives without having asked for anything first -- the others all
 * follow an action they took. Putting it on every message would also push
 * several of them into a second billed segment for no gain.
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
    `${job.city}, ${job.state_code} | ${when} | ${pay}`,
    `First to accept gets it. Expires in ${expiresInHours}h.`,
    link,
    "Reply STOP to opt out.",
  ].join("\n");
}

/**
 * Sent the moment a contractor wins a job. This is where the full work order
 * is released -- exact address and site contact, which were withheld while the
 * job was only an offer.
 */
export function assignedSms(
  job: Pick<
    Job,
    | "job_number"
    | "title"
    | "address_line1"
    | "city"
    | "state_code"
    | "site_contact_name"
    | "site_contact_phone"
    | "scheduled_start"
  >,
  link: string,
): string {
  const lines = [
    `${SMS_SENDER_LABEL}: job ${job.job_number} is yours`,
    job.title,
    `${job.address_line1}, ${job.city}, ${job.state_code}`,
  ];

  if (job.scheduled_start) {
    lines.push(
      new Date(job.scheduled_start).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  }

  // Scheduling is the contractor's job from here, and saying so costs a few
  // characters on one message to one person -- against a site that is not
  // expecting anyone. It is deliberately absent from the offer, which goes to
  // everybody and pays per segment; the offer page carries it instead.
  if (job.site_contact_name || job.site_contact_phone) {
    lines.push(
      `Site contact: ${[job.site_contact_name, job.site_contact_phone]
        .filter(Boolean)
        .join(" ")}`,
      "Call them to schedule the install.",
    );
  } else {
    lines.push("Contact the site to schedule the install.");
  }

  lines.push("Full work order:", link);
  return lines.join("\n");
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

/**
 * Approval notice. Names the Friday the payment is scheduled into, because
 * "when do I get paid" is the question this message exists to answer.
 */
export function approvedSms(
  job: Pick<Job, "job_number" | "contractor_pay_cents" | "currency" | "scheduled_pay_date">,
): string {
  const amount = formatMoney(job.contractor_pay_cents, job.currency);

  if (!job.scheduled_pay_date) {
    return `${SMS_SENDER_LABEL}: job ${job.job_number} approved. ${amount} is queued for the next Friday payment run.`;
  }

  const [year, month, day] = job.scheduled_pay_date.split("-").map(Number);
  const when = new Date(year!, month! - 1, day!).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return `${SMS_SENDER_LABEL}: job ${job.job_number} approved. ${amount} is scheduled for payment on ${when}.`;
}

export function paidSms(
  job: Pick<Job, "job_number" | "contractor_pay_cents" | "currency">,
  reference: string | null,
): string {
  const ref = reference ? ` Ref ${reference}.` : "";
  return `${SMS_SENDER_LABEL}: payment sent for job ${job.job_number} - ${formatMoney(
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
