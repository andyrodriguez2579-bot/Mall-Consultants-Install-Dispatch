"use client";

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
import { formatPhone } from "@/lib/format";
import type { ContractorMatch, JobStatus } from "@/lib/types";
import { type FormState, dispatchJobAction } from "../actions";

const EMPTY: FormState = {};

function SendButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className={buttonClass("primary")}
    >
      {pending
        ? "Sending…"
        : count === 0
          ? "Select contractors"
          : `Send offer to ${count}`}
    </button>
  );
}

/**
 * Contractor selection and dispatch.
 *
 * Matching is advisory, not restrictive: unqualified contractors are shown but
 * cannot be selected, because the acceptance path would refuse them anyway and
 * a silently shortened list makes an admin wonder who is missing and why.
 */
export function DispatchPanel({
  jobId,
  matches,
  jobStatus,
}: {
  jobId: string;
  matches: ContractorMatch[];
  jobStatus: JobStatus;
}) {
  const [state, action] = useActionState(dispatchJobAction, EMPTY);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Pre-select the obvious candidates: qualified and local.
    return new Set(
      matches.filter((m) => m.has_all_skills && m.in_service_area).map((m) => m.contractor_id),
    );
  });

  const [qualifiedOnly, setQualifiedOnly] = useState(true);
  const [areaOnly, setAreaOnly] = useState(false);

  const visible = useMemo(
    () =>
      matches.filter(
        (m) => (!qualifiedOnly || m.has_all_skills) && (!areaOnly || m.in_service_area),
      ),
    [matches, qualifiedOnly, areaOnly],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectableVisible = visible.filter((m) => m.has_all_skills);
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((m) => selected.has(m.contractor_id));

  return (
    <Card>
      <CardHeader
        title="Dispatch"
        description={
          jobStatus === "unfilled"
            ? "The previous round expired unfilled. Sending again opens a new round."
            : "Each contractor receives a secure link that only works for them."
        }
      />

      <form action={action} className="space-y-4 p-4 sm:p-5">
        <input type="hidden" name="job_id" value={jobId} />
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="contractor_ids" value={id} />
        ))}

        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}
        {state.errors?.contractor_ids ? (
          <ErrorBanner>{state.errors.contractor_ids}</ErrorBanner>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={qualifiedOnly}
              onChange={(e) => setQualifiedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Qualified only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={areaOnly}
              onChange={(e) => setAreaOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            In service area
          </label>
          <button
            type="button"
            onClick={() =>
              setSelected(
                allVisibleSelected
                  ? new Set()
                  : new Set(selectableVisible.map((m) => m.contractor_id)),
              )
            }
            className="text-sm font-medium text-blue-700"
          >
            {allVisibleSelected ? "Clear selection" : "Select all shown"}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No contractors match these filters. Loosen the filters, or check that
            contractors have the required certifications on their profile.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {visible.map((m) => {
              const disabled = !m.has_all_skills;
              return (
                <li key={m.contractor_id}>
                  <label
                    className={`flex items-start gap-3 px-3 py-3 ${
                      disabled ? "opacity-60" : "cursor-pointer hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.contractor_id)}
                      onChange={() => toggle(m.contractor_id)}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">
                        {m.full_name}
                        {m.company_name ? (
                          <span className="font-normal text-slate-500"> · {m.company_name}</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {formatPhone(m.phone)}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {m.has_all_skills ? (
                          <Tag tone="good">Qualified</Tag>
                        ) : (
                          <Tag tone="bad">Missing certification</Tag>
                        )}
                        {m.in_service_area ? <Tag tone="info">In service area</Tag> : null}
                        {m.already_offered ? <Tag tone="warn">Already offered</Tag> : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-slate-800">
              Offer window (hours)
            </span>
            <input
              name="expires_in_hours"
              type="number"
              min={0.5}
              max={168}
              step={0.5}
              defaultValue={4}
              className={inputClass + " mt-1.5 w-32"}
            />
          </label>
          <SendButton count={selected.size} />
        </div>
      </form>
    </Card>
  );
}

function Tag({
  children,
  tone,
}: {
  children: string;
  tone: "good" | "bad" | "info" | "warn";
}) {
  const tones = {
    good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    bad: "bg-rose-50 text-rose-700 ring-rose-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
