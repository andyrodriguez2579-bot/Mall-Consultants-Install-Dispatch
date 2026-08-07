"use client";

import { useActionState } from "react";
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
import { formatDateTime } from "@/lib/format";
import type { Contractor, ServiceArea, Skill } from "@/lib/types";
import {
  type ContractorState,
  addContractorNote,
  setContractorStatus,
  updateContractorSkills,
} from "../actions";

const EMPTY: ContractorState = {};

function Submit({ children, tone = "primary" }: { children: string; tone?: "primary" | "secondary" | "success" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function ContractorPanels({
  contractor,
  skills,
  serviceAreas,
  selectedSkillIds,
  selectedAreaIds,
  notes,
}: {
  contractor: Contractor;
  skills: Skill[];
  serviceAreas: ServiceArea[];
  selectedSkillIds: string[];
  selectedAreaIds: string[];
  notes: Array<{ id: string; body: string; created_at: string; author_id: string | null }>;
}) {
  const [skillState, skillAction] = useActionState(updateContractorSkills, EMPTY);
  const [noteState, noteAction] = useActionState(addContractorNote, EMPTY);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Standing"
          description="Only approved contractors receive offers or can accept work."
        />
        <div className="flex flex-wrap gap-2 p-4 sm:p-5">
          {contractor.status !== "approved" ? (
            <form action={setContractorStatus}>
              <input type="hidden" name="contractor_id" value={contractor.id} />
              <input type="hidden" name="status" value="approved" />
              <Submit tone="success">Approve</Submit>
            </form>
          ) : null}
          {contractor.status !== "suspended" ? (
            <form action={setContractorStatus}>
              <input type="hidden" name="contractor_id" value={contractor.id} />
              <input type="hidden" name="status" value="suspended" />
              <Submit tone="danger">Suspend</Submit>
            </form>
          ) : null}
          {contractor.status !== "pending" ? (
            <form action={setContractorStatus}>
              <input type="hidden" name="contractor_id" value={contractor.id} />
              <input type="hidden" name="status" value="pending" />
              <Submit tone="secondary">Move to pending</Submit>
            </form>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Certifications and coverage" />
        <form action={skillAction} className="space-y-4 p-4 sm:p-5">
          <input type="hidden" name="contractor_id" value={contractor.id} />
          {skillState.error ? <ErrorBanner>{skillState.error}</ErrorBanner> : null}
          {skillState.success ? <SuccessBanner>{skillState.success}</SuccessBanner> : null}

          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Certifications</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {skills.map((s) => (
                <label key={s.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    name="skill_ids"
                    value={s.id}
                    defaultChecked={selectedSkillIds.includes(s.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="font-medium text-slate-900">{s.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Service areas</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {serviceAreas.map((a) => (
                <label key={a.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    name="service_area_ids"
                    value={a.id}
                    defaultChecked={selectedAreaIds.includes(a.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="font-medium text-slate-900">{a.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Submit>Save</Submit>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Internal notes"
          description="Visible to administrators only — never to the contractor."
        />
        <form action={noteAction} className="space-y-3 border-b border-slate-200 p-4 sm:p-5">
          <input type="hidden" name="contractor_id" value={contractor.id} />
          {noteState.error ? <ErrorBanner>{noteState.error}</ErrorBanner> : null}
          {noteState.success ? <SuccessBanner>{noteState.success}</SuccessBanner> : null}
          <textarea name="body" rows={2} required className={inputClass} placeholder="Insurance certificate expires in March." />
          {noteState.errors?.body ? (
            <p className="text-xs text-rose-600">{noteState.errors.body}</p>
          ) : null}
          <Submit tone="secondary">Add note</Submit>
        </form>

        {notes.length === 0 ? (
          <EmptyState title="No notes yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {notes.map((note) => (
              <li key={note.id} className="px-4 py-3 sm:px-5">
                <p className="text-sm text-slate-900">{note.body}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(note.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
