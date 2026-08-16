"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  Field,
  FormErrors,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { PricingPanel } from "@/components/pricing-panel";
import type { ExtractedField, ParsedRequest } from "@/lib/intake/parse";
import { sheetInstructions } from "@/lib/intake/summary";
import type { SheetDetails, SheetItem, SheetSection } from "@/lib/intake/workbook";
import type { PriceListItem, Skill } from "@/lib/types";
import {
  type RequestState,
  convertRequestToJob,
  discardRequest,
  reparseRequest,
} from "../actions";

const EMPTY: RequestState = {};

/** ISO timestamp -> value for <input type="datetime-local">, in local time. */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

const val = (f: ExtractedField<string> | null | undefined): string => f?.value ?? "";

/**
 * Shows where a value came from.
 *
 * An operator reviewing an extraction needs to know the difference between
 * "the request said this" and "we inferred it from the shape of the text" --
 * the second deserves a second look.
 */
function Provenance({ field }: { field: ExtractedField<string> | null | undefined }) {
  if (!field) {
    return <span className="text-[11px] font-medium text-amber-700">not found — please fill in</span>;
  }
  return (
    <span
      className="text-[11px] text-slate-400"
      title={field.evidence}
    >
      {field.basis === "label" ? "read from the request" : "inferred"}
    </span>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Creating…" : "Create job"}
    </button>
  );
}

export function ReviewForm({
  requestId,
  parsed,
  priceList,
  skills,
  details,
  contractorBps,
  mileageRate,
  commuterMiles,
}: {
  requestId: string;
  parsed: ParsedRequest;
  priceList: PriceListItem[];
  skills: Skill[];
  details: SheetDetails;
  contractorBps: number;
  mileageRate: number;
  commuterMiles: number;
}) {
  const [state, action] = useActionState(convertRequestToJob, EMPTY);
  const err = state.errors ?? {};

  // The parser's first suggestion, if any, seeds the service and its price.
  const firstSuggestion = (parsed?.suggestedItems ?? [])[0];
  const suggested = firstSuggestion
    ? priceList.find((p) => p.code === firstSuggestion.code)
    : undefined;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-5">
        <input type="hidden" name="request_id" value={requestId} />

        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
        <FormErrors errors={state.errors} />

        <Card>
          <CardHeader title="Job detail" description="Correct anything the parser got wrong." />
          <div className="space-y-4 p-4 sm:p-5">
            <Field label="Job title" error={err.title} required>
              <input name="title" defaultValue={val(parsed?.title)} required className={inputClass} />
              <div className="mt-1"><Provenance field={parsed?.title} /></div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer" error={err.customer_name} required>
                <input
                  name="customer_name"
                  defaultValue={val(parsed?.customer_name)}
                  required
                  className={inputClass}
                />
                <div className="mt-1"><Provenance field={parsed?.customer_name} /></div>
              </Field>
              <Field label="Site name" error={err.site_name}>
                <input name="site_name" defaultValue={val(parsed?.site_name)} className={inputClass} />
                <div className="mt-1"><Provenance field={parsed?.site_name} /></div>
              </Field>
              <Field label="Customer reference / PO" error={err.customer_reference}>
                <input
                  name="customer_reference"
                  defaultValue={val(parsed?.customer_reference)}
                  className={inputClass}
                />
                <div className="mt-1"><Provenance field={parsed?.customer_reference} /></div>
              </Field>
            </div>

            <Field label="Scope of work" error={err.scope} required>
              <textarea
                name="scope"
                rows={5}
                defaultValue={parsed?.scope ?? ""}
                required
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Location" />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <Field label="Street address" error={err.address_line1} required>
              <input
                name="address_line1"
                defaultValue={val(parsed?.address_line1)}
                required
                className={inputClass}
              />
              <div className="mt-1"><Provenance field={parsed?.address_line1} /></div>
            </Field>
            <Field label="Suite / unit" error={err.address_line2}>
              <input name="address_line2" className={inputClass} />
            </Field>
            <Field label="City" error={err.city} required>
              <input name="city" defaultValue={val(parsed?.city)} required className={inputClass} />
              <div className="mt-1"><Provenance field={parsed?.city} /></div>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" error={err.state_code} required>
                <input
                  name="state_code"
                  defaultValue={val(parsed?.state_code)}
                  required
                  maxLength={2}
                  className={inputClass + " uppercase"}
                />
              </Field>
              <Field label="ZIP" error={err.postal_code} required>
                <input
                  name="postal_code"
                  defaultValue={val(parsed?.postal_code)}
                  required
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Site contact and access"
            description="Released to the contractor only once the job is theirs."
          />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <Field label="Site contact" error={err.site_contact_name}>
              <input
                name="site_contact_name"
                defaultValue={val(parsed?.site_contact_name)}
                className={inputClass}
              />
              <div className="mt-1"><Provenance field={parsed?.site_contact_name} /></div>
            </Field>
            <Field label="Contact phone" error={err.site_contact_phone}>
              <input
                name="site_contact_phone"
                type="tel"
                defaultValue={val(parsed?.site_contact_phone)}
                className={inputClass}
              />
              <div className="mt-1"><Provenance field={parsed?.site_contact_phone} /></div>
            </Field>
            <Field
              label="Access notes"
              hint="Parking, badging, loading dock, who to ask for."
              error={err.access_notes}
            >
              <textarea name="access_notes" rows={2} className={inputClass} />
            </Field>
            {/* Prefilled with the parts list so the contractor is told what to
                bring without anyone having to retype it. Editable -- it is a
                starting point, not a fixed record. */}
            <Field label="Site instructions" error={err.instructions}>
              <textarea
                name="instructions"
                rows={details.items.length > 0 ? 10 : 2}
                defaultValue={sheetInstructions(details, parsed, details.customerEmail)}
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        {details.items.length > 0 || details.notes.length > 0 ? (
          <SheetSummary details={details} />
        ) : null}

        {err.lines ? <p className="text-xs text-rose-600">{err.lines}</p> : null}
        <PricingPanel
          priceList={priceList}
          commuterMiles={commuterMiles}
          defaults={{
            lines: suggested
              ? [
                  {
                    serviceItemId: suggested.id,
                    description: suggested.name,
                    unitPriceCents: suggested.customer_labor_price_cents,
                    quantity: firstSuggestion?.quantity ?? 1,
                  },
                ]
              : [],
            contractorBps,
            mileageRate,
          }}
        />
        {err.customer_labor_price ? (
          <p className="text-xs text-rose-600">{err.customer_labor_price}</p>
        ) : null}

        <Card>
          <CardHeader title="Schedule and certifications" />
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Scheduled start" error={err.scheduled_start}>
                <input
                  type="datetime-local"
                  name="scheduled_start"
                  defaultValue={toLocalInput(parsed?.scheduled_start?.value)}
                  className={inputClass}
                />
                <div className="mt-1"><Provenance field={parsed?.scheduled_start} /></div>
              </Field>
              <Field label="Scheduled end" error={err.scheduled_end}>
                <input type="datetime-local" name="scheduled_end" className={inputClass} />
              </Field>
              <Field label="Deadline" error={err.deadline_at}>
                <input
                  type="datetime-local"
                  name="deadline_at"
                  defaultValue={toLocalInput(parsed?.deadline_at?.value)}
                  className={inputClass}
                />
              </Field>
            </div>

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
                    className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="skill_ids"
                      value={skill.id}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="font-medium text-slate-900">{skill.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Submit />
        </div>
      </form>

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <form action={reparseRequest}>
          <input type="hidden" name="request_id" value={requestId} />
          <button type="submit" className={buttonClass("secondary")}>
            Re-run extraction
          </button>
        </form>
        <form action={discardRequest} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="request_id" value={requestId} />
          <input
            name="reason"
            placeholder="Reason for discarding"
            className={inputClass + " w-56"}
          />
          <button type="submit" className={buttonClass("secondary") + " text-rose-700"}>
            Discard
          </button>
        </form>
      </div>
    </div>
  );
}

const SECTION_TITLE: Record<SheetSection, string> = {
  install: "To install",
  dispenser_equipment: "Dispenser equipment",
  chemicals: "Chemicals in use",
};

/** What the sheet asked for, shown before the job is priced. */
function SheetSummary({ details }: { details: SheetDetails }) {
  const sections: SheetSection[] = ["install", "dispenser_equipment", "chemicals"];

  return (
    <Card>
      <CardHeader
        title="What the sheet asks for"
        description="Read from the install sheet. Prefilled into the scope and site instructions below."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {details.notes.length > 0 ? (
          <div>
            <p className="text-sm font-semibold text-slate-900">Notes on the sheet</p>
            {details.notes.map((note) => (
              <p key={note} className="mt-1 text-sm text-slate-700">
                {note}
              </p>
            ))}
          </div>
        ) : null}

        {sections.map((section) => {
          const items = details.items.filter((i) => i.section === section);
          if (items.length === 0) return null;

          return (
            <div key={section}>
              <p className="text-sm font-semibold text-slate-900">
                {SECTION_TITLE[section]}
              </p>
              <ul className="mt-1 space-y-0.5">
                {items.map((item) => (
                  <li
                    key={`${section}-${item.code ?? ""}-${item.description}`}
                    className="flex flex-wrap justify-between gap-x-4 text-sm text-slate-700"
                  >
                    <span>
                      {item.description}{" "}
                      {item.code ? (
                        <span className="font-mono text-[11px] text-slate-400">
                          {item.code}
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-400"> · {item.category}</span>
                    </span>
                    {item.quantity && item.quantity > 1 ? (
                      <span className="tabular-nums text-slate-500">×{item.quantity}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
