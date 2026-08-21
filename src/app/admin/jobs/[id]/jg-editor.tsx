"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ErrorBanner, Field, SuccessBanner, buttonClass, inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { JG_RATE_CARD } from "@/lib/jg/rate-card";
import type { Job, JgSubmission, JgSubmissionLine } from "@/lib/types";
import type { FormState } from "../actions";
import { sendJgSubmission, updateJgSubmission } from "./jg-actions";

const EMPTY: FormState = {};

const toCents = (value: string): number => {
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

interface LineRow {
  key: string;
  itemId: string | null;
  category: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
}

let nextKey = 0;
const newKey = () => `jg-line-${(nextKey += 1)}`;
const emptyLine = (): LineRow => ({
  key: newKey(),
  itemId: null,
  category: "",
  description: "",
  unitPriceCents: 0,
  quantity: 1,
});

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("secondary")}>
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Sending…" : "Send to JG Installations"}
    </button>
  );
}

/**
 * Editing a draft JG submission.
 *
 * Every line is picked from JG's own rate card (src/lib/jg/rate-card.ts) --
 * their prices, not Mall Consultants' -- grouped by category the same way
 * the pricing panel groups the customer price list. Choosing an item fills
 * its category, description and price; only the quantity is typed.
 */
export function JgEditor({
  job,
  submission,
  lines: initialLines,
}: {
  job: Job;
  submission: JgSubmission;
  lines: JgSubmissionLine[];
}) {
  const [saveState, saveAction] = useActionState(updateJgSubmission, EMPTY);
  const [sendState, sendAction] = useActionState(sendJgSubmission, EMPTY);

  const [lines, setLines] = useState<LineRow[]>(() =>
    initialLines.length > 0
      ? initialLines.map((l) => ({
          key: newKey(),
          itemId: l.rate_card_item_id,
          category: l.category,
          description: l.description,
          unitPriceCents: l.unit_price_cents,
          quantity: Number(l.quantity),
        }))
      : [emptyLine()],
  );

  const [accountName, setAccountName] = useState(submission.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(submission.account_number ?? "");
  const [rsmName, setRsmName] = useState(submission.rsm_name ?? "");
  const [opco, setOpco] = useState(submission.opco ?? "");
  const [startMileage, setStartMileage] = useState(String(submission.start_mileage));
  const [endMileage, setEndMileage] = useState(String(submission.end_mileage));
  const [commuterMiles, setCommuterMiles] = useState(String(submission.commuter_miles));
  const [mileageRate, setMileageRate] = useState(String(submission.mileage_rate));
  const [mileageAmount, setMileageAmount] = useState((submission.mileage_cents / 100).toFixed(2));
  const [homeDepot, setHomeDepot] = useState((submission.home_depot_cents / 100).toFixed(2));
  const [lowes, setLowes] = useState((submission.lowes_cents / 100).toFixed(2));
  const [harborFreight, setHarborFreight] = useState((submission.harbor_freight_cents / 100).toFixed(2));
  const [localHardware, setLocalHardware] = useState((submission.local_hardware_cents / 100).toFixed(2));
  const [hotel, setHotel] = useState((submission.hotel_cents / 100).toFixed(2));
  const [tollsParking, setTollsParking] = useState((submission.tolls_parking_cents / 100).toFixed(2));

  const byCategory = useMemo(() => {
    const groups = new Map<string, typeof JG_RATE_CARD>();
    for (const item of JG_RATE_CARD) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups.entries()];
  }, []);

  const update = (key: string, patch: Partial<LineRow>) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function pickItem(key: string, id: string) {
    const item = JG_RATE_CARD.find((i) => i.id === id);
    update(key, {
      itemId: id || null,
      ...(item
        ? { category: item.category, description: item.description, unitPriceCents: item.unitPriceCents }
        : {}),
    });
  }

  const total = lines.reduce((sum, l) => sum + Math.round(l.unitPriceCents * l.quantity), 0);

  return (
    <div className="space-y-4">
      {saveState.error ? <ErrorBanner>{saveState.error}</ErrorBanner> : null}
      {saveState.errors?.lines ? <ErrorBanner>{saveState.errors.lines}</ErrorBanner> : null}
      {saveState.success ? <SuccessBanner>{saveState.success}</SuccessBanner> : null}

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="submission_id" value={submission.id} />
        <input type="hidden" name="job_id" value={job.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name">
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} name="account_name" className={inputClass} />
          </Field>
          <Field label="Account #">
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} name="account_number" className={inputClass} />
          </Field>
          <Field label="Job sent by (RSM)">
            <input value={rsmName} onChange={(e) => setRsmName(e.target.value)} name="rsm_name" className={inputClass} />
          </Field>
          <Field label="OPCO" hint="PFG, BEK, Nicholas, QSR, C-Store, etc.">
            <input value={opco} onChange={(e) => setOpco(e.target.value)} name="opco" className={inputClass} />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Mileage</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-5">
            <Field label="Start">
              <input value={startMileage} onChange={(e) => setStartMileage(e.target.value)} name="start_mileage" inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="End">
              <input value={endMileage} onChange={(e) => setEndMileage(e.target.value)} name="end_mileage" inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Commuter miles">
              <input value={commuterMiles} onChange={(e) => setCommuterMiles(e.target.value)} name="commuter_miles" inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Rate">
              <input value={mileageRate} onChange={(e) => setMileageRate(e.target.value)} name="mileage_rate" inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Milage $">
              <input value={mileageAmount} onChange={(e) => setMileageAmount(e.target.value)} name="mileage_amount" inputMode="decimal" className={inputClass} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Receipts -- not tracked elsewhere in the app, entered by hand
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["home_depot", "Home Depot", homeDepot, setHomeDepot],
                ["lowes", "Lowes", lowes, setLowes],
                ["harbor_freight", "Harbor Freight", harborFreight, setHarborFreight],
                ["local_hardware", "Local hardware", localHardware, setLocalHardware],
                ["hotel", "Hotel", hotel, setHotel],
                ["tolls_parking", "Tolls and parking", tollsParking, setTollsParking],
              ] as const
            ).map(([name, label, value, setter]) => (
              <Field key={name} label={label}>
                <input value={value} onChange={(e) => setter(e.target.value)} name={name} inputMode="decimal" placeholder="0.00" className={inputClass} />
              </Field>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={line.key} className="rounded-lg border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Line {index + 1}
                </span>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                    className="text-xs font-medium text-rose-700"
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <input type="hidden" name="line_rate_card_item_id" value={line.itemId ?? ""} />
              <input type="hidden" name="line_category" value={line.category} />
              <input type="hidden" name="line_description" value={line.description} />
              <input type="hidden" name="line_unit_price" value={(line.unitPriceCents / 100).toFixed(2)} />
              <input type="hidden" name="line_quantity" value={String(line.quantity)} />

              <div className="mt-2 space-y-3">
                <Field label="From JG's rate card" hint="Fills the category, description and price.">
                  <select value={line.itemId ?? ""} onChange={(e) => pickItem(line.key, e.target.value)} className={inputClass}>
                    <option value="">Not on the rate card…</option>
                    {byCategory.map(([category, group]) => (
                      <optgroup key={category} label={category}>
                        {group.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.description} — {formatMoney(item.unitPriceCents)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Field label="Category" required>
                    <input
                      value={line.category}
                      onChange={(e) => update(line.key, { category: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Description" required>
                    <input
                      value={line.description}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="$ per task" required>
                    <input
                      value={line.unitPriceCents === 0 ? "" : (line.unitPriceCents / 100).toFixed(2)}
                      onChange={(e) => update(line.key, { unitPriceCents: toCents(e.target.value) })}
                      inputMode="decimal"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="# of task" required>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: Number(e.target.value) || 0 })}
                      className={inputClass}
                    />
                  </Field>
                  <div className="self-end pb-2 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(Math.round(line.unitPriceCents * line.quantity))}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setLines((rows) => [...rows, emptyLine()])}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add a line
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 pt-3">
          <p className="text-sm font-semibold text-slate-900">Total Job $ {formatMoney(total)}</p>
          <SaveButton />
        </div>
      </form>

      <form action={sendAction} className="border-t border-slate-200 pt-3">
        <input type="hidden" name="submission_id" value={submission.id} />
        <input type="hidden" name="job_id" value={job.id} />
        {sendState.error ? <ErrorBanner>{sendState.error}</ErrorBanner> : null}
        {sendState.success ? <SuccessBanner>{sendState.success}</SuccessBanner> : null}
        <p className="mb-2 text-xs text-slate-500">
          Sends the filled JG workbook exactly as saved above — save your changes first.
        </p>
        <SendButton />
      </form>
    </div>
  );
}
