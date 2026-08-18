"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  SuccessBanner,
  buttonClass,
} from "@/components/ui";
import { formatApproximateLocation, formatMoney } from "@/lib/format";
import { type ClaimState, claimBoardJob } from "./claim-actions";

const EMPTY: ClaimState = {};

export interface BoardJob {
  id: string;
  title: string;
  site_name: string | null;
  city: string;
  state_code: string;
  postal_code: string;
  scope: string;
  contractor_pay_cents: number;
  currency: string;
  scheduled_start: string | null;
  deadline_at: string | null;
}

function Claim() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("success")}>
      {pending ? "Claiming…" : "Claim this job"}
    </button>
  );
}

/**
 * Work standing on the board, claimable by anyone qualified.
 *
 * No expiry and no countdown, unlike an offer: the point of the board is that
 * jobs wait. What it does show is the pay and the approximate area, the same
 * two things an offer leads with, because they are what decides whether the
 * job is worth reading further.
 *
 * The exact address and the site contact are not here. They are released on
 * claiming, as they are on accepting an offer.
 */
export function BoardCard({ jobs }: { jobs: BoardJob[] }) {
  const [state, action] = useActionState(claimBoardJob, EMPTY);

  return (
    <Card>
      <CardHeader
        title="Job board"
        description="Open work. Claim what you can do -- first to claim gets it."
      />

      {state.error ? (
        <div className="px-4 pt-4 sm:px-5">
          <ErrorBanner>{state.error}</ErrorBanner>
        </div>
      ) : null}
      {state.claimedJobId ? (
        <div className="px-4 pt-4 sm:px-5">
          <SuccessBanner>
            This job is yours.{" "}
            <Link
              href={`/jobs/${state.claimedJobId}`}
              className="font-semibold underline underline-offset-2"
            >
              Open the work order
            </Link>{" "}
            for the address and site contact.
          </SuccessBanner>
        </div>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {jobs.map((job) => (
          <li key={job.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{job.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatApproximateLocation(job)}
                </p>
              </div>
              <span className="shrink-0 text-base font-bold tabular-nums text-slate-900">
                {formatMoney(job.contractor_pay_cents, job.currency)}
              </span>
            </div>

            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
              {job.scope}
            </p>

            <form action={action} className="mt-3">
              <input type="hidden" name="job_id" value={job.id} />
              <Claim />
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
