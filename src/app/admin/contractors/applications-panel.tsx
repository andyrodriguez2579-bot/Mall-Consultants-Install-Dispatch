"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { formatDateTime, formatPhone } from "@/lib/format";
import type { ContractorApplication } from "@/lib/types";
import {
  type ContractorState,
  approveApplication,
  declineApplication,
} from "./actions";

const EMPTY: ContractorState = {};

function Submit({
  children,
  tone = "primary",
}: {
  children: string;
  tone?: "primary" | "secondary" | "success" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function ApplicationsPanel({
  applications,
}: {
  applications: ContractorApplication[];
}) {
  return (
    <Card>
      <CardHeader
        title={`Applications${applications.length ? ` (${applications.length})` : ""}`}
        description="People who applied through the public link. Approving creates their account; nothing has been created yet."
      />
      {applications.length === 0 ? (
        <EmptyState
          title="No applications waiting"
          description="Share your apply link and they will appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {applications.map((application) => (
            <ApplicationRow key={application.id} application={application} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ApplicationRow({ application }: { application: ContractorApplication }) {
  const [approveState, approve] = useActionState(approveApplication, EMPTY);
  const [declineState, decline] = useActionState(declineApplication, EMPTY);
  const [showDecline, setShowDecline] = useState(false);

  const state = declineState.success || declineState.error ? declineState : approveState;

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {application.full_name}
            {application.company_name ? (
              <span className="ml-2 font-normal text-slate-500">
                {application.company_name}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm text-slate-700">
            {formatPhone(application.phone)}
            <span className="mx-2 text-slate-300">|</span>
            {application.email}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[
              [application.city, application.state_code].filter(Boolean).join(", "),
              application.max_travel_miles
                ? `travels ${application.max_travel_miles} mi`
                : null,
              `applied ${formatDateTime(application.created_at)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* Whether they agreed to texts decides how you reach them, so it is on
            the row rather than behind a click. */}
        <span
          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            application.sms_opt_in
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-slate-100 text-slate-700 ring-slate-200"
          }`}
        >
          {application.sms_opt_in ? "SMS consent given" : "No SMS consent"}
        </span>
      </div>

      {application.experience ? (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          {application.experience}
        </p>
      ) : null}

      {state.error ? (
        <div className="mt-3">
          <ErrorBanner>{state.error}</ErrorBanner>
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-3">
          <SuccessBanner>{state.success}</SuccessBanner>
        </div>
      ) : null}

      {!state.success ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={approve}>
            <input type="hidden" name="application_id" value={application.id} />
            <Submit tone="success">Approve and add</Submit>
          </form>

          {showDecline ? (
            <form action={decline} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="application_id" value={application.id} />
              <input
                name="decline_reason"
                placeholder="Reason (optional, not sent)"
                className={inputClass + " max-w-xs"}
              />
              <Submit tone="danger">Confirm decline</Submit>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowDecline(true)}
              className={buttonClass("secondary")}
            >
              Decline
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}
