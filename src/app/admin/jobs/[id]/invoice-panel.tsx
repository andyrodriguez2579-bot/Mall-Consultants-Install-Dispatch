import { Card, CardHeader, Field, buttonClass, inputClass } from "@/components/ui";
import { INVOICE_RECIPIENT_EMAIL } from "@/lib/branding";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Invoice, InvoiceLineItem, Job } from "@/lib/types";
import { createInvoiceDraft, voidInvoice } from "./invoice-actions";
import { InvoiceEditor } from "./invoice-editor";

/**
 * Billing the customer for a finished job.
 *
 * One live invoice per job at a time (the database's own unique index, not
 * just this UI): a draft can be edited freely, a sent one is fixed, and
 * voiding a sent one is what makes room to issue a corrected replacement --
 * never an edit to what already went out.
 */
export function InvoicePanel({
  job,
  liveInvoice,
  lines,
  voided,
}: {
  job: Job;
  liveInvoice: Invoice | null;
  lines: InvoiceLineItem[];
  voided: Invoice[];
}) {
  return (
    <Card>
      <CardHeader
        title="Invoice"
        description={`Emailed to ${INVOICE_RECIPIENT_EMAIL} when you send it — never automatically.`}
      />
      <div className="space-y-4 p-4 sm:p-5">
        {!liveInvoice ? (
          <form action={createInvoiceDraft}>
            <input type="hidden" name="job_id" value={job.id} />
            <button type="submit" className={buttonClass("primary")}>
              Create invoice
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Starts from this job&apos;s pricing — services, mileage and approved
              expenses. Nothing here can change what the contractor was paid, and
              nothing sends until you click Send.
            </p>
          </form>
        ) : liveInvoice.status === "draft" ? (
          <InvoiceEditor job={job} invoice={liveInvoice} lines={lines} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  INV-{liveInvoice.invoice_number}
                </p>
                <p className="text-xs text-slate-500">
                  Sent {formatDateTime(liveInvoice.sent_at)} to {liveInvoice.sent_to_email}
                </p>
              </div>
              <p className="text-lg font-bold tabular-nums text-slate-900">
                {formatMoney(liveInvoice.subtotal_cents)}
              </p>
            </div>

            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="flex justify-between gap-4 px-3 py-2 text-sm text-slate-700"
                >
                  <span>
                    {line.description}{" "}
                    <span className="text-xs text-slate-400">x{Number(line.quantity)}</span>
                  </span>
                  <span className="tabular-nums text-slate-800">
                    {formatMoney(line.line_total_cents)}
                  </span>
                </li>
              ))}
            </ul>

            <form action={voidInvoice} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="invoice_id" value={liveInvoice.id} />
              <input type="hidden" name="job_id" value={job.id} />
              <div className="min-w-48 flex-1">
                <Field label="Reason (optional)">
                  <input
                    name="reason"
                    placeholder="Wrong amount, reissuing"
                    className={inputClass}
                  />
                </Field>
              </div>
              <button type="submit" className={buttonClass("secondary")}>
                Void &amp; reissue
              </button>
            </form>
          </div>
        )}

        {voided.length > 0 ? (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">
              Voided invoices ({voided.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {voided.map((inv) => (
                <li key={inv.id}>
                  INV-{inv.invoice_number} — voided {formatDateTime(inv.voided_at)}
                  {inv.void_reason ? ` — ${inv.void_reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
