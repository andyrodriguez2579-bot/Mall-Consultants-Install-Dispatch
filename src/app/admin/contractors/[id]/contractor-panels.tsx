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
import type { Contractor, Profile, ServiceArea, Skill } from "@/lib/types";
import {
  type ContractorState,
  addContractorNote,
  deleteContractor,
  setContractorStatus,
  updateContractor,
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
  profile,
  skills,
  serviceAreas,
  selectedSkillIds,
  selectedAreaIds,
  notes,
}: {
  contractor: Contractor;
  profile: Profile;
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
      <EditPanel contractor={contractor} profile={profile} />
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

      <DeletePanel contractorId={contractor.id} />
    </div>
  );
}

/**
 * Correcting the details.
 *
 * The mobile number is the one that matters: it is where offers go and how a
 * contractor signs in, and a wrong one is silent -- offers simply never arrive.
 * Until this existed the only remedy for a typo was to delete the contractor
 * and add them again, which threw away their history to fix a digit.
 */
function EditPanel({ contractor, profile }: { contractor: Contractor; profile: Profile }) {
  const [state, action] = useActionState(updateContractor, EMPTY);

  return (
    <Card>
      <CardHeader
        title="Details"
        description="The mobile number is where job offers are sent and how this contractor signs in."
      />
      <form action={action} className="space-y-4 p-4 sm:p-5">
        <input type="hidden" name="contractor_id" value={contractor.id} />
        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={state.errors?.full_name}>
            <input
              name="full_name"
              defaultValue={profile.full_name}
              className={inputClass}
            />
          </Field>
          <Field label="Mobile" error={state.errors?.phone}>
            <input
              name="phone"
              defaultValue={profile.phone ?? ""}
              inputMode="tel"
              className={inputClass}
            />
          </Field>
          <Field label="Email" error={state.errors?.email}>
            <input
              name="email"
              type="email"
              defaultValue={profile.email ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Company" error={state.errors?.company_name}>
            <input
              name="company_name"
              defaultValue={contractor.company_name ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Travel radius (miles)" error={state.errors?.max_travel_miles}>
            <input
              name="max_travel_miles"
              inputMode="numeric"
              defaultValue={contractor.max_travel_miles ?? ""}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              name="sms_opt_in"
              defaultChecked={contractor.sms_opt_in}
              className="h-4 w-4 rounded border-slate-300"
            />
            Send job offers by text message
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              name="is_available"
              defaultChecked={contractor.is_available}
              className="h-4 w-4 rounded border-slate-300"
            />
            Currently available for work
          </label>
        </div>

        <Submit>Save changes</Submit>
      </form>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </label>
  );
}

/**
 * Deletion, gated behind typing the word.
 *
 * A contractor record holds someone's real mobile number, so removing a
 * mistaken entry has to be possible from here rather than requiring a trip into
 * the database. It is also irreversible and sits below every other control, so
 * the confirmation is a typed word rather than a second click.
 */
function DeletePanel({ contractorId }: { contractorId: string }) {
  const [state, action] = useActionState(deleteContractor, EMPTY);

  return (
    <Card className="border-rose-200">
      <CardHeader
        title="Delete this contractor"
        description="Removes the record, the profile and the login, and frees the email and mobile number for re-use. A contractor who is on any job cannot be deleted -- suspend them instead."
      />
      <form action={action} className="space-y-3 p-4 sm:p-5">
        <input type="hidden" name="contractor_id" value={contractorId} />
        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

        <label className="block">
          <span className="block text-sm font-medium text-slate-800">
            Type DELETE to confirm
          </span>
          <input
            name="confirm"
            autoComplete="off"
            placeholder="DELETE"
            className={inputClass + " mt-1.5 max-w-xs"}
          />
        </label>
        {state.errors?.confirm ? (
          <p className="text-xs text-rose-600">{state.errors.confirm}</p>
        ) : null}

        <Submit tone="danger">Delete permanently</Submit>
      </form>
    </Card>
  );
}
