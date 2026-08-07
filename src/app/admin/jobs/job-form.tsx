"use client";

import { useActionState } from "react";
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
import { PricingPanel, type PricingDefaults } from "@/components/pricing-panel";
import type { Job, PriceListItem, Skill } from "@/lib/types";
import { type FormState, createJob, updateJob } from "./actions";

const EMPTY: FormState = {};

/** ISO timestamp -> value for <input type="datetime-local">, in local time. */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function Actions({ isEdit, payLocked }: { isEdit: boolean; payLocked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-col gap-2 sm:flex-row-reverse">
      <button
        type="submit"
        name="intent"
        value="ready"
        disabled={pending}
        className={buttonClass("primary")}
      >
        {pending ? "Saving…" : isEdit ? "Save changes" : "Save as ready to dispatch"}
      </button>
      {!isEdit ? (
        <button
          type="submit"
          name="intent"
          value="draft"
          disabled={pending}
          className={buttonClass("secondary")}
        >
          Save as draft
        </button>
      ) : null}
      {payLocked ? (
        <p className="self-center text-xs text-slate-500 sm:mr-auto">
          Pay is locked — this job has been dispatched.
        </p>
      ) : null}
    </div>
  );
}

export function JobForm({
  skills,
  priceList,
  job,
  selectedSkillIds = [],
  pricingDefaults,
  commuterMiles = 30,
}: {
  skills: Skill[];
  priceList: PriceListItem[];
  job?: Job;
  selectedSkillIds?: string[];
  pricingDefaults?: PricingDefaults;
  commuterMiles?: number;
}) {
  const isEdit = Boolean(job);
  const [state, action] = useActionState(isEdit ? updateJob : createJob, EMPTY);
  const err = state.errors ?? {};
  const payLocked = Boolean(job && job.status !== "draft" && job.status !== "ready");

  return (
    <form action={action} className="space-y-5">
      {job ? <input type="hidden" name="job_id" value={job.id} /> : null}

      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
      {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

      <Card>
        <CardHeader title="The work" />
        <div className="space-y-4 p-4 sm:p-5">
          <Field label="Job title" error={err.title} required>
            <input
              name="title"
              defaultValue={job?.title}
              required
              placeholder="SSDC retrofit — Galleria corridor C"
              className={inputClass}
            />
          </Field>

          <Field label="Scope of work" error={err.scope} required
                 hint="What the contractor is committing to. Shown before they accept.">
            <textarea
              name="scope"
              rows={5}
              defaultValue={job?.scope}
              required
              className={inputClass}
            />
          </Field>

          <Field
            label="Site instructions"
            error={err.instructions}
            hint="Parking, badging, who to ask for. Shown only after the job is assigned."
          >
            <textarea
              name="instructions"
              rows={3}
              defaultValue={job?.instructions ?? ""}
              className={inputClass}
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium text-slate-800">
              Required certifications
            </legend>
            <p className="mt-0.5 text-xs text-slate-500">
              A contractor without every one of these cannot accept the job.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {skills.map((skill) => (
                <label
                  key={skill.id}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    name="skill_ids"
                    value={skill.id}
                    defaultChecked={selectedSkillIds.includes(skill.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="font-medium text-slate-900">{skill.name}</span>
                    {skill.description ? (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {skill.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card>
        <CardHeader title="Customer and location" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Customer" error={err.customer_name} required>
            <input
              name="customer_name"
              defaultValue={job?.customer_name}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Site name" error={err.site_name}>
            <input name="site_name" defaultValue={job?.site_name ?? ""} className={inputClass} />
          </Field>
          <Field label="Street address" error={err.address_line1} required>
            <input
              name="address_line1"
              defaultValue={job?.address_line1}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Suite / unit" error={err.address_line2}>
            <input
              name="address_line2"
              defaultValue={job?.address_line2 ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="City" error={err.city} required>
            <input name="city" defaultValue={job?.city} required className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" error={err.state_code} required>
              <input
                name="state_code"
                defaultValue={job?.state_code}
                required
                maxLength={2}
                placeholder="TX"
                className={inputClass + " uppercase"}
              />
            </Field>
            <Field label="ZIP" error={err.postal_code} required>
              <input
                name="postal_code"
                defaultValue={job?.postal_code}
                required
                inputMode="numeric"
                placeholder="77056"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Site contact and access"
          description="Withheld while the job is only an offer, released the moment it is accepted."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Site contact" error={err.site_contact_name}>
            <input
              name="site_contact_name"
              defaultValue={job?.site_contact_name ?? ""}
              placeholder="Danielle Ruiz"
              className={inputClass}
            />
          </Field>
          <Field label="Contact phone" error={err.site_contact_phone}>
            <input
              name="site_contact_phone"
              type="tel"
              defaultValue={job?.site_contact_phone ?? ""}
              placeholder="(713) 555-0199"
              className={inputClass}
            />
          </Field>
          <Field
            label="Access notes"
            hint="Parking, badging, loading dock, who to ask for."
            error={err.access_notes}
          >
            <textarea
              name="access_notes"
              rows={2}
              defaultValue={job?.access_notes ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Customer reference / PO" error={err.customer_reference}>
            <input
              name="customer_reference"
              defaultValue={job?.customer_reference ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Account number" error={err.account_number}>
            <input
              name="account_number"
              defaultValue={job?.account_number ?? ""}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <PricingPanel
        priceList={priceList}
        defaults={pricingDefaults}
        commuterMiles={commuterMiles}
        disabled={payLocked}
      />

      <Card>
        <CardHeader title="Schedule" />
        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <Field label="Scheduled start" error={err.scheduled_start}>
            <input
              type="datetime-local"
              name="scheduled_start"
              defaultValue={toLocalInput(job?.scheduled_start)}
              className={inputClass}
            />
          </Field>
          <Field label="Scheduled end" error={err.scheduled_end}>
            <input
              type="datetime-local"
              name="scheduled_end"
              defaultValue={toLocalInput(job?.scheduled_end)}
              className={inputClass}
            />
          </Field>
          <Field label="Deadline" error={err.deadline_at} hint="Must be complete by.">
            <input
              type="datetime-local"
              name="deadline_at"
              defaultValue={toLocalInput(job?.deadline_at)}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Actions isEdit={isEdit} payLocked={payLocked} />
    </form>
  );
}
