import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, Detail, JobStatusBadge } from "@/components/ui";
import { requireApprovedContractor } from "@/lib/auth";
import {
  formatAddress,
  formatDateTime,
  formatMoney,
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
          {job.instructions ? (
            <Detail
              label="Site instructions"
              className="sm:col-span-2"
              value={<span className="whitespace-pre-wrap">{job.instructions}</span>}
            />
          ) : null}
        </dl>
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
