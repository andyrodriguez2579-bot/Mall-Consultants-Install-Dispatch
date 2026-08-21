import { Card, CardHeader, Field, buttonClass, inputClass } from "@/components/ui";
import { INVOICE_RECIPIENT_EMAIL } from "@/lib/branding";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Job, JgSubmission, JgSubmissionLine } from "@/lib/types";
import { createJgSubmissionDraft, voidJgSubmission } from "./jg-actions";
import { JgEditor } from "./jg-editor";

/**
 * Reporting a job to JG Installations for payment.
 *
 * A different recipient purpose than the customer invoice above, even though
 * both happen to reach the same inbox: this is what gets Mall Consultants
 * paid, using JG's own fixed rate card, not what Mall Consultants bills the
 * customer.
 */
export function JgPanel({
  job,
  liveSubmission,
  lines,
  voided,
}: {
  job: Job;
  liveSubmission: JgSubmission | null;
  lines: JgSubmissionLine[];
  voided: JgSubmission[];
}) {
  return (
    <Card>
      <CardHeader
        title="JG Installations submission"
        description={`What gets Mall Consultants paid for this job — sent to ${INVOICE_RECIPIENT_EMAIL} as their own workbook, filled in.`}
      />
      <div className="space-y-4 p-4 sm:p-5">
        {!liveSubmission ? (
          <form action={createJgSubmissionDraft}>
            <input type="hidden" name="job_id" value={job.id} />
            <button type="submit" className={buttonClass("primary")}>
              Create submission
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Starts with the account, RSM and mileage prefilled from this job. Pick
              which of JG&apos;s rate-card items apply before sending.
            </p>
          </form>
        ) : liveSubmission.status === "draft" ? (
          <JgEditor job={job} submission={liveSubmission} lines={lines} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Job {job.job_number}</p>
                <p className="text-xs text-slate-500">
                  Sent {formatDateTime(liveSubmission.sent_at)} to {liveSubmission.sent_to_email}
                </p>
              </div>
              <p className="text-lg font-bold tabular-nums text-slate-900">
                {formatMoney(liveSubmission.lines_subtotal_cents)}
              </p>
            </div>

            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="flex justify-between gap-4 px-3 py-2 text-sm text-slate-700"
                >
                  <span>
                    {line.description}{" "}
                    <span className="text-xs text-slate-400">x{Number(line.quantity)}</span>
                  </span>
                  <span className="tabular-nums text-slate-800">
                    {formatMoney(line.line_total_cents)}
                  </span>
                </li>
              ))}
            </ul>

            <form action={voidJgSubmission} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="submission_id" value={liveSubmission.id} />
              <input type="hidden" name="job_id" value={job.id} />
              <div className="min-w-48 flex-1">
                <Field label="Reason (optional)">
                  <input name="reason" placeholder="Wrong quantity, reissuing" className={inputClass} />
                </Field>
              </div>
              <button type="submit" className={buttonClass("secondary")}>
                Void &amp; reissue
              </button>
            </form>
          </div>
        )}

        {voided.length > 0 ? (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">
              Voided submissions ({voided.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {voided.map((s) => (
                <li key={s.id}>
                  Voided {formatDateTime(s.voided_at)}
                  {s.void_reason ? ` — ${s.void_reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
