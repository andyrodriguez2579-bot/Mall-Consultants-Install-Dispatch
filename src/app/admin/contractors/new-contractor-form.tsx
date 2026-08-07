"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  Field,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import type { ServiceArea, Skill } from "@/lib/types";
import { type ContractorState, createContractor } from "./actions";

const EMPTY: ContractorState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Adding…" : "Add contractor"}
    </button>
  );
}

export function NewContractorForm({
  skills,
  serviceAreas,
}: {
  skills: Skill[];
  serviceAreas: ServiceArea[];
}) {
  const [state, action] = useActionState(createContractor, EMPTY);
  const [open, setOpen] = useState(false);
  const err = state.errors ?? {};

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary")}>
        Add a contractor
      </button>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Add a contractor"
        description="They start pending. Approve them once their paperwork is verified."
      />
      <form action={action} className="space-y-4 p-4 sm:p-5">
        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={err.full_name} required>
            <input name="full_name" required className={inputClass} />
          </Field>
          <Field label="Business name" error={err.company_name}>
            <input name="company_name" className={inputClass} />
          </Field>
          <Field
            label="Mobile number"
            error={err.phone}
            required
            hint="Where job offers are texted."
          >
            <input name="phone" type="tel" required placeholder="(713) 555-0201" className={inputClass} />
          </Field>
          <Field label="Email" error={err.email} required hint="Used for account recovery.">
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="Willing to travel (miles)" error={err.max_travel_miles}>
            <input name="max_travel_miles" type="number" min={0} className={inputClass} />
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Certifications</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {skills.map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name="skill_ids" value={s.id} className="h-4 w-4 rounded border-slate-300" />
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
                <input type="checkbox" name="service_area_ids" value={a.id} className="h-4 w-4 rounded border-slate-300" />
                <span className="font-medium text-slate-900">{a.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex gap-2">
          <Submit />
          <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
            Close
          </button>
        </div>
      </form>
    </Card>
  );
}
