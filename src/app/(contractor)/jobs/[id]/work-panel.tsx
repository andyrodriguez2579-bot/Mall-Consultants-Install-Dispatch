"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  InfoBanner,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import type { Job } from "@/lib/types";
import { type WorkState, confirmArrival, startWork, submitCompletion } from "../actions";
import { PhotoUploader } from "./photo-uploader";

const EMPTY: WorkState = {};

/** "Friday, Apr 24" from a plain date, without timezone drift. */
function payDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function Submit({ children, tone = "primary" }: { children: string; tone?: "primary" | "secondary" | "success" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone, true)}>
      {pending ? "Working…" : children}
    </button>
  );
}

/**
 * The contractor's on-site flow: confirm arrival, start, document, submit.
 *
 * Only the step that is actually next is shown. Someone standing in a corridor
 * holding a drill should not have to work out which of six buttons applies.
 */
export function WorkPanel({
  job,
  beforeCount,
  afterCount,
}: {
  job: Job;
  beforeCount: number;
  afterCount: number;
}) {
  const [state, action] = useActionState(submitCompletion, EMPTY);

  if (job.status === "completed") {
    return (
      <Card>
        <CardHeader title="Submitted" />
        <div className="space-y-3 p-4 sm:p-5">
          <SuccessBanner>
            Your work has been submitted and is waiting for review. We will text you when
            it is approved.
          </SuccessBanner>
          {job.field_ticket_ref ? (
            <p className="text-sm text-slate-600">
              Field ticket{" "}
              <span className="font-mono font-medium text-slate-900">
                {job.field_ticket_ref}
              </span>
            </p>
          ) : null}
        </div>
      </Card>
    );
  }

  if (job.status === "approved" || job.status === "paid") {
    return (
      <Card>
        <CardHeader title={job.status === "paid" ? "Paid" : "Approved"} />
        <div className="space-y-3 p-4 sm:p-5">
          <SuccessBanner>
            {job.status === "paid"
              ? `Payment sent${job.payment_reference ? ` — reference ${job.payment_reference}` : ""}.`
              : "Your work was approved."}
          </SuccessBanner>

          {job.status === "approved" ? (
            <p className="text-sm text-slate-700">
              {job.scheduled_pay_date ? (
                <>
                  Scheduled for payment on{" "}
                  <span className="font-semibold">{payDateLabel(job.scheduled_pay_date)}</span>.
                </>
              ) : (
                "Queued for the next Friday payment run."
              )}
            </p>
          ) : null}

          <p className="text-xs text-slate-500">Payments are processed every Friday.</p>
        </div>
      </Card>
    );
  }

  const notStarted = job.status === "assigned";
  const working = job.status === "in_progress" || job.status === "needs_rework";

  return (
    <Card>
      <CardHeader title="On site" />
      <div className="space-y-4 p-4 sm:p-5">
        {job.status === "needs_rework" && job.rework_notes ? (
          <ErrorBanner>
            <span className="font-semibold">Rework requested:</span> {job.rework_notes}
          </ErrorBanner>
        ) : null}

        {notStarted ? (
          <>
            {!job.arrival_confirmed_at ? (
              <form action={confirmArrival}>
                <input type="hidden" name="job_id" value={job.id} />
                <Submit tone="secondary">I have arrived on site</Submit>
              </form>
            ) : (
              <InfoBanner>Arrival confirmed. Start work when you are ready.</InfoBanner>
            )}
            <form action={startWork}>
              <input type="hidden" name="job_id" value={job.id} />
              <Submit>Start work</Submit>
            </form>
          </>
        ) : null}

        {working ? (
          <>
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-800">
                Photos{" "}
                <span className="font-normal text-slate-500">
                  (optional — {beforeCount} before, {afterCount} after)
                </span>
              </p>
              <p className="-mt-1.5 text-xs text-slate-500">
                Your field ticket is the record of the work. Add photos here only if
                something is worth flagging.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <PhotoUploader jobId={job.id} kind="before" label="Add before photos" />
                <PhotoUploader jobId={job.id} kind="after" label="Add after photos" />
              </div>
            </div>

            <form action={action} className="space-y-3 border-t border-slate-200 pt-4">
              <input type="hidden" name="job_id" value={job.id} />

              {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
              {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

              <label className="block">
                <span className="block text-sm font-medium text-slate-800">
                  Field ticket number
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  From the field ticket app. This is what your completed work is checked
                  against, so it has to match.
                </span>
                <input
                  name="field_ticket_ref"
                  required
                  defaultValue={job.field_ticket_ref ?? ""}
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="FT-2026-4417"
                  className={inputClass + " mt-1.5 font-mono"}
                />
              </label>
              {state.errors?.field_ticket_ref ? (
                <p className="text-xs text-rose-600">{state.errors.field_ticket_ref}</p>
              ) : null}

              <label className="block">
                <span className="block text-sm font-medium text-slate-800">
                  Completion notes
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  What you did, anything the customer should know.
                </span>
                <textarea
                  name="notes"
                  rows={4}
                  required
                  defaultValue={job.completion_notes ?? ""}
                  className={inputClass + " mt-1.5"}
                  placeholder="Replaced the controller board on unit 3 and re-commissioned. Verified handshake with the BMS."
                />
              </label>
              {state.errors?.notes ? (
                <p className="text-xs text-rose-600">{state.errors.notes}</p>
              ) : null}

              <Submit tone="success">Mark work complete</Submit>
            </form>
          </>
        ) : null}
      </div>
    </Card>
  );
}
