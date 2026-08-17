import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, Detail, JobStatusBadge } from "@/components/ui";
import { requireApprovedContractor } from "@/lib/auth";
import {
  formatAddress,
  formatDateTime,
  formatMoney,
  formatPhone,
} from "@/lib/format";
import { signAttachments } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobAttachment } from "@/lib/types";
import { WorkPanel } from "./work-panel";

export const dynamic = "force-dynamic";

export default async function ContractorJobDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireApprovedContractor();
  const { id } = await params;
  const supabase = await createClient();

  // Row-level security already limits this to jobs offered to or assigned to
  // this contractor; the explicit assignee check below narrows it further to
  // the work surface.
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle<Job>();

  if (!job) notFound();
  if (job.assigned_contractor_id !== user.id) notFound();

  const { data: attachmentRows } = await supabase
    .from("job_attachments")
    .select("*")
    .eq("job_id", id)
    .order("created_at");

  const attachments = (attachmentRows ?? []) as JobAttachment[];
  const photos = await signAttachments(
    attachments.filter((a) => a.kind === "before" || a.kind === "after"),
  );
  const before = photos.filter((p) => p.kind === "before");
  const after = photos.filter((p) => p.kind === "after");

  const mapsHref = `https://maps.google.com/?q=${encodeURIComponent(formatAddress(job))}`;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/jobs" className="text-sm font-medium text-blue-700">
          ← My jobs
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">{job.title}</h1>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{job.job_number}</p>
          </div>
          <JobStatusBadge status={job.status} />
        </div>
      </div>

      <Card>
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Your pay for this job
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
            {formatMoney(job.contractor_pay_cents, job.currency)}
          </p>

          {/* The breakdown of their own payment. The customer price and the
              Mall Consultants share are not on this table at all. */}
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
            <li className="flex justify-between gap-3 text-slate-600">
              <span>Labor</span>
              <span className="tabular-nums">
                {formatMoney(job.contractor_labor_pay_cents, job.currency)}
              </span>
            </li>
            {job.mileage_payment_cents > 0 ? (
              <li className="flex justify-between gap-3 text-slate-600">
                <span>
                  Mileage — {Number(job.payable_miles)} payable miles at $
                  {Number(job.mileage_rate).toFixed(3)}
                </span>
                <span className="tabular-nums">
                  {formatMoney(job.mileage_payment_cents, job.currency)}
                </span>
              </li>
            ) : null}
            {job.total_expenses_cents > 0 ? (
              <li className="flex justify-between gap-3 text-slate-600">
                <span>Approved expenses</span>
                <span className="tabular-nums">
                  {formatMoney(job.total_expenses_cents, job.currency)}
                </span>
              </li>
            ) : null}
          </ul>

          <p className="mt-3 text-xs text-slate-500">
            Fixed for this job. Payments are processed every Friday.
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Detail label="Customer" value={job.customer_name} />
          <Detail label="Site" value={job.site_name ?? "—"} />
          <Detail
            label="Address"
            className="sm:col-span-2"
            value={
              <a href={mapsHref} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2">
                {formatAddress(job)}
              </a>
            }
          />
          <Detail label="Scheduled start" value={formatDateTime(job.scheduled_start)} />
          <Detail label="Scheduled end" value={formatDateTime(job.scheduled_end)} />
          {job.deadline_at ? (
            <Detail label="Must be complete by" value={formatDateTime(job.deadline_at)} />
          ) : null}
          <Detail
            label="Scope of work"
            className="sm:col-span-2"
            value={<span className="whitespace-pre-wrap">{job.scope}</span>}
          />
          {job.customer_reference ? (
            <Detail label="Customer reference" value={job.customer_reference} />
          ) : null}
          {job.account_number ? (
            <Detail label="Account number" value={job.account_number} />
          ) : null}
          {job.program_name ? <Detail label="Program" value={job.program_name} /> : null}
          {job.field_ticket_ref ? (
            <Detail
              label="Field ticket"
              value={<span className="font-mono">{job.field_ticket_ref}</span>}
            />
          ) : null}
        </dl>

        {/* Everything below is released only once the job is assigned. While it
            was an offer, the contractor saw the neighbourhood and the scope --
            not the doorstep or who to ask for. */}
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Work order detail
          </p>

          {/* The site is not expecting anyone until the contractor rings them.
              The number was already here, but a number in a details list reads
              as reference material rather than as the next thing to do, and a
              job can sit accepted for days on that misunderstanding. Shown
              until the work actually starts, and tappable, because this is read
              on a phone. */}
          {job.status === "assigned" ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                Call the customer to schedule
              </p>
              <p className="mt-1 text-sm text-amber-900">
                You arrange the date and time directly with the site. Nobody is
                expecting you until you do.
              </p>
              {job.site_contact_phone ? (
                <a
                  href={`tel:${job.site_contact_phone}`}
                  className="mt-3 inline-flex items-center rounded-md bg-amber-900 px-3 py-2 text-sm font-semibold text-white"
                >
                  Call {job.site_contact_name ?? formatPhone(job.site_contact_phone)}
                </a>
              ) : null}
            </div>
          ) : null}

          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Detail
              label="Site contact"
              value={
                job.site_contact_name || job.site_contact_phone ? (
                  <span>
                    {job.site_contact_name ?? "—"}
                    {job.site_contact_phone ? (
                      <a
                        href={`tel:${job.site_contact_phone}`}
                        className="ml-2 font-medium text-blue-700 underline underline-offset-2"
                      >
                        {formatPhone(job.site_contact_phone)}
                      </a>
                    ) : null}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            {job.access_notes ? (
              <Detail
                label="Access"
                value={<span className="whitespace-pre-wrap">{job.access_notes}</span>}
              />
            ) : null}
            {job.instructions ? (
              <Detail
                label="Site instructions"
                className="sm:col-span-2"
                value={<span className="whitespace-pre-wrap">{job.instructions}</span>}
              />
            ) : null}
          </dl>
        </div>
      </Card>

      <WorkPanel job={job} beforeCount={before.length} afterCount={after.length} />

      {photos.length > 0 ? (
        <Card>
          <CardHeader title="Your photos" />
          <div className="space-y-4 p-4 sm:p-5">
            {(
              [
                ["Before", before],
                ["After", after],
              ] as const
            ).map(([label, list]) =>
              list.length > 0 ? (
                <div key={label}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <ul className="mt-2 grid grid-cols-3 gap-2">
                    {list.map((photo) => (
                      <li key={photo.id}>
                        {photo.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo.url}
                            alt={`${label} photo`}
                            className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <div className="aspect-square w-full rounded-lg bg-slate-100" />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
