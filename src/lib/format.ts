import type { JobStatus, OfferStatus } from "./types";

/**
 * Money is stored in integer cents everywhere; format only at the edge.
 *
 * Always two decimal places, including on whole dollars. A financial breakdown
 * that mixes "$120" with "$14.50" is harder to scan and reads as sloppy on a
 * document someone is being paid from.
 */
export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Parse "1,250" / "$1,250.00" / "1250.5" into integer cents. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "in 3h 20m" / "2h ago" -- offer windows are short, so precision matters. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const deltaMs = new Date(value).getTime() - Date.now();
  const past = deltaMs < 0;
  const mins = Math.floor(Math.abs(deltaMs) / 60000);

  if (mins < 1) return past ? "just now" : "in under a minute";
  if (mins < 60) return past ? `${mins}m ago` : `in ${mins}m`;

  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    const label = remMins ? `${hours}h ${remMins}m` : `${hours}h`;
    return past ? `${label} ago` : `in ${label}`;
  }

  const days = Math.floor(hours / 24);
  return past ? `${days}d ago` : `in ${days}d`;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return e164;
}

export function formatAddress(job: {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_code: string;
  postal_code: string;
}): string {
  const street = [job.address_line1, job.address_line2].filter(Boolean).join(", ");
  return `${street}, ${job.city}, ${job.state_code} ${job.postal_code}`;
}

/**
 * Contractors see the neighbourhood before they accept, not the doorstep.
 * The precise address is revealed once the job is theirs.
 */
export function formatApproximateLocation(job: {
  city: string;
  state_code: string;
  postal_code: string;
  site_name?: string | null;
}): string {
  const area = `${job.city}, ${job.state_code} ${job.postal_code}`;
  return job.site_name ? `${job.site_name} — ${area}` : area;
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  offered: "Offered",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  needs_rework: "Needs Rework",
  approved: "Approved",
  paid: "Paid",
  on_hold: "On Hold",
  cancelled: "Cancelled",
  unfilled: "Unfilled",
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  delivered: "Delivered",
  viewed: "Viewed",
  accepted: "Accepted",
  passed: "Passed",
  expired: "Expired",
  filled: "Filled by another",
  failed: "Failed",
};

/** Tailwind classes per status, kept in one place so badges stay consistent. */
export const JOB_STATUS_TONE: Record<JobStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  ready: "bg-sky-50 text-sky-800 ring-sky-200",
  offered: "bg-amber-50 text-amber-900 ring-amber-300",
  assigned: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  in_progress: "bg-blue-50 text-blue-800 ring-blue-200",
  completed: "bg-violet-50 text-violet-800 ring-violet-200",
  needs_rework: "bg-orange-50 text-orange-900 ring-orange-300",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  paid: "bg-emerald-600 text-white ring-emerald-700",
  on_hold: "bg-yellow-50 text-yellow-900 ring-yellow-300",
  cancelled: "bg-slate-200 text-slate-600 ring-slate-300",
  unfilled: "bg-rose-50 text-rose-800 ring-rose-200",
};

export const OFFER_STATUS_TONE: Record<OfferStatus, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-200",
  sent: "bg-sky-50 text-sky-800 ring-sky-200",
  delivered: "bg-blue-50 text-blue-800 ring-blue-200",
  viewed: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  accepted: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  passed: "bg-slate-200 text-slate-600 ring-slate-300",
  expired: "bg-rose-50 text-rose-800 ring-rose-200",
  filled: "bg-slate-200 text-slate-600 ring-slate-300",
  failed: "bg-red-100 text-red-800 ring-red-300",
};
