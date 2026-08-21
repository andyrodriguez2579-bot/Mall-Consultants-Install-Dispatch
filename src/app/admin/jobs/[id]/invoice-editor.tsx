"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ErrorBanner, Field, SuccessBanner, buttonClass, inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { Invoice, InvoiceLineItem, Job } from "@/lib/types";
import type { FormState } from "../actions";
import { sendInvoice, updateInvoice } from "./invoice-actions";

const EMPTY: FormState = {};

const toCents = (value: string): number => {
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

interface LineRow {
  key: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
}

let nextKey = 0;
const newKey = () => `inv-line-${(nextKey += 1)}`;
const emptyLine = (): LineRow => ({
  key: newKey(),
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
      {pending ? "Sending…" : "Send invoice"}
    </button>
  );
}

/**
 * Editing a draft invoice.
 *
 * Mirrors the pricing panel's line-row shape (`src/components/pricing-panel.tsx`)
 * -- a bordered block per line, hidden inputs carrying the client-side state as
 * parallel arrays the server reads back with `getAll()` -- but this is a
 * simpler document: no price-list lookup, no labor split, just what the
 * customer is being billed.
 *
 * Saving and sending are two forms on purpose. Send reads back whatever the
 * database currently holds, not whatever is unsaved in these inputs, so it
 * cannot mail out an edit nobody committed.
 */
export function InvoiceEditor({
  job,
  invoice,
  lines: initialLines,
}: {
  job: Job;
  invoice: Invoice;
  lines: InvoiceLineItem[];
}) {
  const [saveState, saveAction] = useActionState(updateInvoice, EMPTY);
  const [sendState, sendAction] = useActionState(sendInvoice, EMPTY);

  const [lines, setLines] = useState<LineRow[]>(() =>
    initialLines.length > 0
      ? initialLines.map((l) => ({
          key: newKey(),
          description: l.description,
          unitPriceCents: l.unit_price_cents,
          quantity: Number(l.quantity),
        }))
      : [emptyLine()],
  );
  const [billToName, setBillToName] = useState(invoice.bill_to_name ?? job.customer_name);
  const [billToAddress, setBillToAddress] = useState(invoice.bill_to_address ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");

  const update = (key: string, patch: Partial<LineRow>) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const total = lines.reduce((sum, l) => sum + Math.round(l.unitPriceCents * l.quantity), 0);

  return (
    <div className="space-y-4">
      {saveState.error ? <ErrorBanner>{saveState.error}</ErrorBanner> : null}
      {saveState.errors?.lines ? <ErrorBanner>{saveState.errors.lines}</ErrorBanner> : null}
      {saveState.success ? <SuccessBanner>{saveState.success}</SuccessBanner> : null}

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="invoice_id" value={invoice.id} />
        <input type="hidden" name="job_id" value={job.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bill to">
            <input
              name="bill_to_name"
              value={billToName}
              onChange={(e) => setBillToName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Billing address">
            <input
              name="bill_to_address"
              value={billToAddress}
              onChange={(e) => setBillToAddress(e.target.value)}
              className={inputClass}
            />
          </Field>
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

              <input type="hidden" name="line_description" value={line.description} />
              <input
                type="hidden"
                name="line_unit_price"
                value={(line.unitPriceCents / 100).toFixed(2)}
              />
              <input type="hidden" name="line_quantity" value={String(line.quantity)} />

              <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Field label="Description" required>
                  <input
                    value={line.description}
                    onChange={(e) => update(line.key, { description: e.target.value })}
                    placeholder="SSDC A-Program Installation"
                    className={inputClass}
                  />
                </Field>
                <Field label="Amount" required>
                  <input
                    value={line.unitPriceCents === 0 ? "" : (line.unitPriceCents / 100).toFixed(2)}
                    onChange={(e) => update(line.key, { unitPriceCents: toCents(e.target.value) })}
                    inputMode="decimal"
                    placeholder="450.00"
                    className={inputClass}
                  />
                </Field>
                <Field label="Qty" required>
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
          ))}

          <button
            type="button"
            onClick={() => setLines((rows) => [...rows, emptyLine()])}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add a line
          </button>
        </div>

        <Field label="Notes" hint="Printed on the invoice, e.g. payment terms.">
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </Field>

        <div className="flex items-center justify-between border-t border-slate-200 pt-3">
          <p className="text-sm font-semibold text-slate-900">Total {formatMoney(total)}</p>
          <SaveButton />
        </div>
      </form>

      <form action={sendAction} className="border-t border-slate-200 pt-3">
        <input type="hidden" name="invoice_id" value={invoice.id} />
        <input type="hidden" name="job_id" value={job.id} />
        {sendState.error ? <ErrorBanner>{sendState.error}</ErrorBanner> : null}
        {sendState.success ? <SuccessBanner>{sendState.success}</SuccessBanner> : null}
        <p className="mb-2 text-xs text-slate-500">
          Sends exactly what is saved above — save your changes first.
        </p>
        <SendButton />
      </form>
    </div>
  );
}
