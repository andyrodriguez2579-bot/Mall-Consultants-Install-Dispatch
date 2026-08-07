"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { type PaymentState, recordPaymentRun } from "./actions";
import type { PayableJob } from "./page";

const EMPTY: PaymentState = {};

function Submit({ count, total }: { count: number; total: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className={buttonClass("success")}
    >
      {pending
        ? "Recording…"
        : count === 0
          ? "Select jobs"
          : `Mark ${count} paid — ${formatMoney(total)}`}
    </button>
  );
}

function friendlyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * One Friday's payment run.
 *
 * Everything in the run is selected by default, since the normal action is to
 * pay the whole batch. Individual jobs can be held back -- a disputed ticket,
 * say -- and simply roll into the next run.
 */
export function PaymentRunForm({
  payDate,
  jobs,
  overdue,
}: {
  payDate: string;
  jobs: PayableJob[];
  overdue: boolean;
}) {
  const [state, action] = useActionState(recordPaymentRun, EMPTY);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(jobs.map((j) => j.id)),
  );

  const total = useMemo(
    () =>
      jobs
        .filter((j) => selected.has(j.id))
        .reduce((sum, j) => sum + j.contractor_pay_cents, 0),
    [jobs, selected],
  );

  // Contractors care about their own total, so show the run broken down by who
  // is being paid rather than only by job.
  const byContractor = useMemo(() => {
    const groups = new Map<string, { name: string; jobs: PayableJob[]; total: number }>();
    for (const job of jobs) {
      const key = job.assignee?.id ?? "unassigned";
      const entry = groups.get(key) ?? {
        name: job.assignee?.full_name ?? "Unassigned",
        jobs: [],
        total: 0,
      };
      entry.jobs.push(job);
      if (selected.has(job.id)) entry.total += job.contractor_pay_cents;
      groups.set(key, entry);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title={friendlyDate(payDate)}
        description={
          overdue
            ? "This run is past due — these were scheduled for an earlier Friday."
            : `${jobs.length} job${jobs.length === 1 ? "" : "s"} scheduled for this run`
        }
        action={
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.id)),
              )
            }
            className="text-sm font-medium text-blue-700"
          >
            {selected.size === jobs.length ? "Clear all" : "Select all"}
          </button>
        }
      />

      <form action={action}>
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="job_ids" value={id} />
        ))}

        <div className="divide-y divide-slate-100">
          {byContractor.map((group) => (
            <div key={group.name} className="px-4 py-3 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{group.name}</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatMoney(group.total)}
                </p>
              </div>
              <ul className="mt-2 space-y-1.5">
                {group.jobs.map((job) => (
                  <li key={job.id}>
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(job.id)}
                        onChange={() => toggle(job.id)}
                        className="h-4 w-4 shrink-0 rounded border-slate-300"
                      />
                      <Link
                        href={`/admin/jobs/${job.id}`}
                        className="min-w-0 flex-1 truncate text-slate-600 hover:text-blue-700"
                      >
                        <span className="font-mono text-xs text-slate-400">
                          {job.job_number}
                        </span>{" "}
                        {job.title}
                      </Link>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {formatMoney(job.contractor_pay_cents, job.currency)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-slate-200 p-4 sm:p-5">
          {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
          {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-slate-800">Reference</span>
              <input
                name="reference"
                required
                placeholder={`ACH-${payDate}`}
                className={inputClass + " mt-1.5 w-48"}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-800">Method</span>
              <input
                name="method"
                defaultValue="ACH"
                className={inputClass + " mt-1.5 w-32"}
              />
            </label>
            <Submit count={selected.size} total={total} />
          </div>
        </div>
      </form>
    </Card>
  );
}
