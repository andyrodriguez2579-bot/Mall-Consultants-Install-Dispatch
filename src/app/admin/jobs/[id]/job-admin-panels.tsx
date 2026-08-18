"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  Detail,
  ErrorBanner,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ContractorMatch, Job } from "@/lib/types";
import {
  type FormState,
  approveJob,
  assignContractor,
  cancelJob,
  duplicateJob,
  markPaid,
  reopenForDispatch,
  setBoardPosting,
  requestRework,
} from "../actions";

const EMPTY: FormState = {};

function Submit({
  children,
  tone = "primary",
}: {
  children: string;
  tone?: "primary" | "secondary" | "danger" | "success";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function JobAdminPanels({
  job,
  matches,
}: {
  job: Job;
  matches: ContractorMatch[];
}) {
  return (
    <div className="space-y-5">
      {job.status === "completed" ? <ReviewPanel job={job} /> : null}
      {job.status === "approved" ? <PaymentPanel job={job} /> : null}
      {job.status === "paid" ? <PaidSummary job={job} /> : null}
      <ManagePanel job={job} matches={matches} />
    </div>
  );
}

/** Approve the submitted work, or send it back with instructions. */
function ReviewPanel({ job }: { job: Job }) {
  const [state, action] = useActionState(requestRework, EMPTY);
  const [showRework, setShowRework] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Review submitted work"
        description="Approve to make the fixed contractor payment due."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

        <div className="flex flex-wrap gap-2">
          <form action={approveJob}>
            <input type="hidden" name="job_id" value={job.id} />
            <Submit tone="success">
              {`Approve — ${formatMoney(job.contractor_pay_cents, job.currency)} due`}
            </Submit>
          </form>
          {!showRework ? (
            <button
              type="button"
              onClick={() => setShowRework(true)}
              className={buttonClass("secondary")}
            >
              Request rework
            </button>
          ) : null}
        </div>

        {showRework ? (
          <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
            <input type="hidden" name="job_id" value={job.id} />
            <label className="block">
              <span className="block text-sm font-medium text-slate-800">
                What needs to be corrected?
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Texted to the contractor and shown on their job page.
              </span>
              <textarea
                name="notes"
                rows={3}
                required
                className={inputClass + " mt-1.5"}
                placeholder="The after photo of the north unit is out of focus — please resubmit."
              />
            </label>
            {state.errors?.notes ? (
              <p className="text-xs text-rose-600">{state.errors.notes}</p>
            ) : null}
            <div className="flex gap-2">
              <Submit tone="danger">Send back for rework</Submit>
              <button
                type="button"
                onClick={() => setShowRework(false)}
                className={buttonClass("secondary")}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Records a payment. No payment rail is integrated -- this is the ledger entry
 * confirming money was sent by whatever means the business already uses.
 */
function PaymentPanel({ job }: { job: Job }) {
  const [state, action] = useActionState(markPaid, EMPTY);

  return (
    <Card>
      <CardHeader
        title="Payment"
        description="Approved work. Record the payment once it has been sent."
      />
      <form action={action} className="space-y-4 p-4 sm:p-5">
        <input type="hidden" name="job_id" value={job.id} />

        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

        <p className="text-sm text-slate-700">
          Amount owed:{" "}
          <span className="font-semibold">
            {formatMoney(job.contractor_pay_cents, job.currency)}
          </span>{" "}
          <span className="text-slate-500">— the fixed amount the contractor accepted.</span>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-sm font-medium text-slate-800">Reference</span>
            <input
              name="reference"
              required
              placeholder="ACH-2026-0418"
              className={inputClass + " mt-1.5"}
            />
            {state.errors?.reference ? (
              <span className="mt-1 block text-xs text-rose-600">{state.errors.reference}</span>
            ) : null}
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-800">Method</span>
            <input
              name="method"
              placeholder="ACH"
              className={inputClass + " mt-1.5"}
            />
          </label>
        </div>

        <Submit tone="success">Record payment</Submit>
      </form>
    </Card>
  );
}

function PaidSummary({ job }: { job: Job }) {
  return (
    <Card>
      <CardHeader title="Payment" />
      <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 sm:p-5">
        <Detail label="Amount" value={formatMoney(job.contractor_pay_cents, job.currency)} />
        <Detail label="Reference" value={job.payment_reference ?? "—"} />
        <Detail label="Paid" value={formatDateTime(job.paid_at)} />
      </dl>
    </Card>
  );
}

/** Reassign, reopen, duplicate, cancel. */
function ManagePanel({ job, matches }: { job: Job; matches: ContractorMatch[] }) {
  const [assignState, assignAction] = useActionState(assignContractor, EMPTY);
  const [cancelState, cancelAction] = useActionState(cancelJob, EMPTY);
  const [showAssign, setShowAssign] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  const eligible = matches.filter(
    (m) => m.has_all_skills && m.contractor_id !== job.assigned_contractor_id,
  );

  const canAssign = !["paid", "cancelled"].includes(job.status);
  const canReopen = ["unfilled", "on_hold", "cancelled"].includes(job.status);
  const canCancel = job.status !== "paid" && job.status !== "cancelled";

  return (
    <Card>
      <CardHeader title="Manage" />
      <div className="space-y-4 p-4 sm:p-5">
        {assignState.error ? <ErrorBanner>{assignState.error}</ErrorBanner> : null}
        {assignState.success ? <SuccessBanner>{assignState.success}</SuccessBanner> : null}
        {cancelState.error ? <ErrorBanner>{cancelState.error}</ErrorBanner> : null}
        {cancelState.success ? <SuccessBanner>{cancelState.success}</SuccessBanner> : null}

        <div className="flex flex-wrap gap-2">
          {canAssign && !showAssign ? (
            <button
              type="button"
              onClick={() => setShowAssign(true)}
              className={buttonClass("secondary")}
            >
              {job.assigned_contractor_id ? "Reassign" : "Assign directly"}
            </button>
          ) : null}

          {canReopen ? (
            <form action={reopenForDispatch}>
              <input type="hidden" name="job_id" value={job.id} />
              <Submit tone="secondary">Reopen for dispatch</Submit>
            </form>
          ) : null}

          {/* Available while the job is unclaimed, including on a draft: a
              backlog is built before anyone is chosen to do it. */}
          {!job.assigned_contractor_id ? (
            <form action={setBoardPosting}>
              <input type="hidden" name="job_id" value={job.id} />
              <input type="hidden" name="post" value={job.board_posted_at ? "0" : "1"} />
              <Submit tone={job.board_posted_at ? "secondary" : "success"}>
                {job.board_posted_at ? "Remove from board" : "Post to job board"}
              </Submit>
            </form>
          ) : null}

          <a href={`/admin/jobs/${job.id}/ticket`} className={buttonClass("secondary")}>
            Field ticket
          </a>

          <form action={duplicateJob}>
            <input type="hidden" name="job_id" value={job.id} />
            <Submit tone="secondary">Duplicate</Submit>
          </form>

          {canCancel && !showCancel ? (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className={buttonClass("secondary") + " text-rose-700"}
            >
              Cancel job
            </button>
          ) : null}
        </div>

        {showAssign ? (
          <form action={assignAction} className="space-y-3 rounded-lg border border-slate-200 p-4">
            <input type="hidden" name="job_id" value={job.id} />
            <p className="text-sm text-slate-600">
              Assigning directly bypasses the offer race. Only contractors holding every
              required certification are listed.
            </p>
            <label className="block">
              <span className="block text-sm font-medium text-slate-800">Contractor</span>
              <select name="contractor_id" required className={inputClass + " mt-1.5"}>
                <option value="">Choose a contractor…</option>
                {eligible.map((m) => (
                  <option key={m.contractor_id} value={m.contractor_id}>
                    {m.full_name}
                    {m.company_name ? ` — ${m.company_name}` : ""}
                    {m.in_service_area ? " (in area)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-800">Reason</span>
              <input
                name="reason"
                placeholder="Customer requested this crew"
                className={inputClass + " mt-1.5"}
              />
            </label>
            <div className="flex gap-2">
              <Submit>Assign</Submit>
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                className={buttonClass("secondary")}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {showCancel ? (
          <form action={cancelAction} className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
            <input type="hidden" name="job_id" value={job.id} />
            <label className="block">
              <span className="block text-sm font-medium text-slate-800">
                Why is this job being cancelled?
              </span>
              <input name="reason" required className={inputClass + " mt-1.5"} />
            </label>
            {cancelState.errors?.reason ? (
              <p className="text-xs text-rose-700">{cancelState.errors.reason}</p>
            ) : null}
            <div className="flex gap-2">
              <Submit tone="danger">Cancel this job</Submit>
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                className={buttonClass("secondary")}
              >
                Keep it
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
