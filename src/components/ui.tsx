import type { ReactNode } from "react";
import {
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  OFFER_STATUS_LABEL,
  OFFER_STATUS_TONE,
} from "@/lib/format";
import type { JobStatus, OfferStatus } from "@/lib/types";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${JOB_STATUS_TONE[status]}`}
    >
      {JOB_STATUS_LABEL[status]}
    </span>
  );
}

export function OfferStatusBadge({ status }: { status: OfferStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${OFFER_STATUS_TONE[status]}`}
    >
      {OFFER_STATUS_LABEL[status]}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Label/value pair used throughout the job detail screens. */
export function Detail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Inline error banner. Errors are shown next to the thing that failed rather
 * than as a toast -- a contractor who taps Accept and loses the race needs to
 * see why on the page they are already looking at.
 */
/**
 * Every validation error on a form, in one place.
 *
 * Field errors are rendered beside their field, which works only for fields
 * that have somewhere to render one. An error whose key nothing displays --
 * because the field moved, or was replaced by a list -- makes the submit button
 * do nothing at all, with no explanation. Listing them all here means a form
 * can fail to save, but it can never fail silently.
 */
export function FormErrors({ errors }: { errors?: Record<string, string> }) {
  const messages = [...new Set(Object.values(errors ?? {}))];
  if (messages.length === 0) return null;

  return (
    <ErrorBanner>
      {messages.length === 1 ? (
        messages[0]
      ) : (
        <>
          <p className="font-medium">Please fix the following:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </ErrorBanner>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      {children}
    </div>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
    >
      {children}
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      {children}
    </div>
  );
}

const BUTTON_TONES = {
  primary:
    "bg-blue-700 text-white hover:bg-blue-800 focus-visible:outline-blue-700 disabled:bg-blue-300",
  secondary:
    "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-500 disabled:text-slate-400",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600 disabled:bg-rose-300",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-600 disabled:bg-emerald-300",
} as const;

export type ButtonTone = keyof typeof BUTTON_TONES;

export function buttonClass(tone: ButtonTone = "primary", full = false) {
  return [
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold",
    "transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed",
    BUTTON_TONES[tone],
    full ? "w-full" : "",
  ].join(" ");
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-800">
        {label}
        {required ? <span className="ml-0.5 text-rose-600">*</span> : null}
      </span>
      {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-lg border-0 px-3 py-2.5 text-slate-900 ring-1 ring-inset ring-slate-300 " +
  "placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm";

export function StatCard({
  label,
  value,
  tone = "default",
  href,
}: {
  label: string;
  value: number | string;
  tone?: "default" | "warn" | "good";
  href?: string;
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-700"
      : tone === "good"
        ? "text-emerald-700"
        : "text-slate-900";

  const body = (
    <>
      <dt className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </>
  );

  const className =
    "rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm" +
    (href ? " transition hover:border-slate-300 hover:shadow" : "");

  if (href) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}
