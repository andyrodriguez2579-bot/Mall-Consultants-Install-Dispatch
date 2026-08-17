import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { ORG_NAME } from "@/lib/branding";
import { formatAddress, formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { profilesByIds } from "@/lib/people";
import { signAttachments } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobAttachment } from "@/lib/types";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * The field ticket: one page of what was done, ready for the printer.
 *
 * This replaces a separate browser-only ticket app whose output reached the
 * office as paper, retyped by hand. Everything here was submitted by the
 * contractor from a phone on site, so nothing needs re-entering -- the page is
 * a rendering of the record, not another place to record it.
 *
 * Money is deliberately limited to reimbursables. Labor pay and the customer
 * price are both absent, because this sheet gets handed to whoever asks for
 * proof of the work -- the customer included -- and neither of them should
 * learn the split from a printout. Reimbursable expenses stay because they are
 * receipts being claimed, not margin.
 */

type LineRow = { description: string; quantity: number; sort_order: number };

export default async function FieldTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: jobRow }, { data: lineRows }, { data: attachmentRows }] =
    await Promise.all([
      supabase.from("jobs").select("*").eq("id", id).maybeSingle<Job>(),
      supabase
        .from("job_service_lines")
        .select("description, quantity, sort_order")
        .eq("job_id", id)
        .order("sort_order"),
      supabase
        .from("job_attachments")
        .select("*")
        .eq("job_id", id)
        .order("created_at"),
    ]);

  if (!jobRow) notFound();
  const job = jobRow;

  const people = await profilesByIds(supabase, [job.assigned_contractor_id]);
  const contractor = job.assigned_contractor_id
    ? people.get(job.assigned_contractor_id)
    : null;

  const lines = (lineRows ?? []) as LineRow[];
  const photos = await signAttachments(
    ((attachmentRows ?? []) as JobAttachment[]).filter(
      (a) => a.kind === "before" || a.kind === "after",
    ),
  );

  const expenses: Array<[string, number]> = [
    ["Materials", job.materials_cents],
    ["Tolls and parking", job.tolls_parking_cents],
    ["Hotel", job.hotel_cents],
    ["Other", job.other_expenses_cents],
  ];
  const claimedExpenses = expenses.filter(([, cents]) => cents > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/admin/jobs/${job.id}`} className="text-sm font-medium text-blue-700">
          ← Back to job
        </Link>
        <div className="flex items-center gap-2">
          {photos.length > 0 ? (
            <a
              href={`/admin/jobs/${job.id}/photos`}
              className={buttonClass("secondary")}
              download
            >
              Download {photos.length} photo{photos.length === 1 ? "" : "s"}
            </a>
          ) : null}
          <PrintButton />
        </div>
      </div>

      <div className="bg-white p-6 text-slate-900 ring-1 ring-slate-200 print:p-0 print:ring-0">
        <header className="flex items-start justify-between border-b border-slate-300 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">
              {ORG_NAME}
            </p>
            <h1 className="mt-0.5 text-xl font-bold">Field Ticket</h1>
          </div>
          <div className="text-right text-sm">
            <p className="font-mono font-semibold">{job.job_number}</p>
            {job.field_ticket_ref ? (
              <p className="font-mono text-xs text-slate-600">
                Ticket {job.field_ticket_ref}
              </p>
            ) : null}
          </div>
        </header>

        {/* Headings and order follow the report this replaces. The invoicing
            agent reading it has seen hundreds of the old ones, and a familiar
            sheet is read correctly at a glance where a rearranged one is read
            twice. */}
        <Section title="Account & job information">
          <Row label="Account name" value={job.customer_name} />
          <Row label="Account #" value={job.account_number} />
          <Row label="Site" value={job.site_name} />
          <Row label="Address" value={formatAddress(job)} />
          <Row label="Date completed" value={formatDateTime(job.completed_at)} />
          <Row label="Job sent by / RSM" value={job.rsm_name} />
          <Row label="OpCo / program" value={job.program_name} />
          <Row label="Customer reference" value={job.customer_reference} />
          <Row label="Contractor" value={contractor?.full_name ?? null} />
          <Row
            label="Contractor phone"
            value={contractor?.phone ? formatPhone(contractor.phone) : null}
          />
          <Row label="Site contact" value={job.site_contact_name} />
          <Row label="On site" value={formatDateTime(job.arrival_confirmed_at)} />
        </Section>

        <Section title="Work order / scope requested" wide>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.scope}</p>
        </Section>

        {lines.length > 0 ? (
          <>
            <Section title="Work completed" wide>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                {lines.map((line, index) => (
                  <li key={index} className="uppercase">
                    {line.description}
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="Work performed / billable items" wide>
              <table className="w-full text-sm">
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index} className="border-b border-slate-200">
                      <td className="py-1.5">{line.description}</td>
                      <td className="w-20 py-1.5 text-right tabular-nums">
                        Qty {line.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </>
        ) : null}

        {job.completion_notes ? (
          <Section title="Completion notes" wide>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {job.completion_notes}
            </p>
          </Section>
        ) : null}

        {job.start_odometer !== null || job.end_odometer !== null ? (
          <Section title="Receipts, expenses & mileage">
            <Row label="Start odometer" value={fmtNumber(job.start_odometer)} />
            <Row label="End odometer" value={fmtNumber(job.end_odometer)} />
            <Row label="Mileage" value={miles(job.contractor_miles)} />
            <Row label="Payable miles" value={miles(job.payable_miles)} />
          </Section>
        ) : null}

        {claimedExpenses.length > 0 ? (
          <Section title="Reimbursable expenses" wide>
            <table className="w-full text-sm">
              <tbody>
                {claimedExpenses.map(([label, cents]) => (
                  <tr key={label} className="border-b border-slate-200">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatMoney(cents, job.currency)}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatMoney(job.total_expenses_cents, job.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
            {job.expenses_approved_at ? (
              <p className="mt-2 text-xs text-slate-600">
                Approved {formatDateTime(job.expenses_approved_at)}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-600">Not yet approved.</p>
            )}
          </Section>
        ) : null}

        {photos.length > 0 ? (
          <Section title="Photographs" wide>
            {(["before", "after"] as const).map((kind) => {
              const group = photos.filter((p) => p.kind === kind);
              if (group.length === 0) return null;

              return (
                <div key={kind} className="mt-2 break-inside-avoid">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {kind}
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.map((photo) =>
                      photo.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={photo.id}
                          src={photo.url}
                          alt={photo.caption ?? `${kind} photo`}
                          className="w-full rounded border border-slate-200 object-cover"
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              );
            })}
          </Section>
        ) : null}

        <div className="mt-8 grid gap-6 border-t border-slate-300 pt-6 sm:grid-cols-2">
          {["Contractor signature", "Customer signature", "Print name", "Date"].map(
            (label) => (
              <div key={label}>
                <div className="h-8 border-b border-slate-400" />
                <p className="mt-1 text-xs text-slate-500">{label}</p>
              </div>
            ),
          )}
        </div>

        <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
          {ORG_NAME} - Field Service Report | {job.job_number} | Prepared for invoicing
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Kept off a page break so a heading never prints alone at the foot of a
    // sheet with its content overleaf.
    <section className="mt-6 break-inside-avoid">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <div className={wide ? "mt-2" : "mt-2 grid grid-cols-2 gap-x-6 gap-y-1"}>
        {children}
      </div>
    </section>
  );
}

/** Omitted entirely when empty: a printed form of blank labels reads as missing
 *  information rather than as inapplicable. */
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === "—") return null;
  return (
    <p className="text-sm">
      <span className="text-slate-500">{label}: </span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

function fmtNumber(value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function miles(value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return `${value} mi`;
}
