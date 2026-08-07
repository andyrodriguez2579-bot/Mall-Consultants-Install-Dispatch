import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardHeader,
  Detail,
  EmptyState,
  InfoBanner,
  JobStatusBadge,
  OfferStatusBadge,
  buttonClass,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import {
  formatAddress,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  formatRelative,
} from "@/lib/format";
import { signAttachments } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type {
  AuditEntry,
  ContractorMatch,
  Job,
  JobAttachment,
  JobLineItem,
  JobOffer,
  Profile,
  Skill,
} from "@/lib/types";
import { DispatchPanel } from "./dispatch-panel";
import { JobAdminPanels } from "./job-admin-panels";

export const dynamic = "force-dynamic";

type OfferRow = JobOffer & { contractor: Pick<Profile, "id" | "full_name" | "phone"> | null };

export default async function AdminJobDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle<Job>();

  if (!job) notFound();

  const [
    { data: offerRows },
    { data: skillRows },
    { data: attachmentRows },
    { data: assigneeRow },
    { data: matchRows },
    { data: auditRows },
    { data: lineItemRows },
  ] = await Promise.all([
    supabase
      .from("job_offers")
      .select("*, contractor:contractor_id(id, full_name, phone)")
      .eq("job_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("job_skills").select("skills(id, slug, name, description, is_active)").eq("job_id", id),
    supabase.from("job_attachments").select("*").eq("job_id", id).order("created_at"),
    job.assigned_contractor_id
      ? supabase
          .from("profiles")
          .select("id, full_name, phone, email")
          .eq("id", job.assigned_contractor_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.rpc("match_contractors_for_job", { p_job_id: id }),
    supabase
      .from("audit_log")
      .select("*")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("job_line_items").select("*").eq("job_id", id).order("sort_order"),
  ]);

  const offers = (offerRows ?? []) as unknown as OfferRow[];
  const requiredSkills = ((skillRows ?? []) as unknown as Array<{ skills: Skill }>)
    .map((r) => r.skills)
    .filter(Boolean);
  const attachments = (attachmentRows ?? []) as JobAttachment[];
  const assignee = assigneeRow as Pick<Profile, "id" | "full_name" | "phone" | "email"> | null;
  const matches = (matchRows ?? []) as ContractorMatch[];
  const audit = (auditRows ?? []) as AuditEntry[];
  const lineItems = (lineItemRows ?? []) as JobLineItem[];

  const photos = await signAttachments(
    attachments.filter((a) => a.kind === "before" || a.kind === "after"),
  );
  const beforePhotos = photos.filter((p) => p.kind === "before");
  const afterPhotos = photos.filter((p) => p.kind === "after");

  const currentRoundOffers = offers.filter((o) => o.round === job.offer_round);
  const questions = offers.filter((o) => o.question);
  const canDispatch = ["draft", "ready", "unfilled", "on_hold"].includes(job.status);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/jobs" className="text-sm font-medium text-blue-700">
          ← Jobs
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{job.title}</h1>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{job.job_number}</p>
          </div>
          <div className="flex items-center gap-2">
            <JobStatusBadge status={job.status} />
            <Link href={`/admin/jobs/${id}/edit`} className={buttonClass("secondary") + " tap"}>
              Edit
            </Link>
          </div>
        </div>
      </div>

      {job.status === "needs_rework" && job.rework_notes ? (
        <InfoBanner>
          <span className="font-semibold">Rework requested:</span> {job.rework_notes}
        </InfoBanner>
      ) : null}
      {job.status === "cancelled" && job.cancel_reason ? (
        <InfoBanner>
          <span className="font-semibold">Cancelled:</span> {job.cancel_reason}
        </InfoBanner>
      ) : null}

      <Card>
        <CardHeader title="Job detail" />
        <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Detail label="Customer" value={job.customer_name} />
          <Detail label="Site" value={job.site_name ?? "—"} />
          <Detail label="Address" value={formatAddress(job)} className="sm:col-span-2" />
          <Detail
            label="Contractor pay"
            value={
              <span>
                <span className="text-base font-semibold">
                  {formatMoney(job.contractor_pay_cents, job.currency)}
                </span>
                {job.pay_source === "manual" ? (
                  <span className="ml-2 text-xs text-amber-700">
                    set by hand
                    {job.pay_override_reason ? ` — ${job.pay_override_reason}` : ""}
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-slate-500">from work items</span>
                )}
              </span>
            }
          />
          <Detail label="Deadline" value={formatDateTime(job.deadline_at)} />
          {job.customer_reference ? (
            <Detail label="Customer reference" value={job.customer_reference} />
          ) : null}
          {job.scheduled_pay_date ? (
            <Detail
              label="Payment scheduled"
              value={formatDate(`${job.scheduled_pay_date}T12:00:00`)}
            />
          ) : null}
          {job.site_contact_name || job.site_contact_phone ? (
            <Detail
              label="Site contact"
              value={
                <span>
                  {job.site_contact_name ?? "—"}
                  {job.site_contact_phone ? (
                    <span className="ml-2 text-slate-500">
                      {formatPhone(job.site_contact_phone)}
                    </span>
                  ) : null}
                </span>
              }
            />
          ) : null}
          {job.access_notes ? (
            <Detail
              label="Access"
              className="sm:col-span-2"
              value={<span className="whitespace-pre-wrap">{job.access_notes}</span>}
            />
          ) : null}
          <Detail label="Scheduled start" value={formatDateTime(job.scheduled_start)} />
          <Detail label="Scheduled end" value={formatDateTime(job.scheduled_end)} />
          <Detail
            label="Scope"
            value={<span className="whitespace-pre-wrap">{job.scope}</span>}
            className="sm:col-span-2"
          />
          {job.instructions ? (
            <Detail
              label="Site instructions"
              value={<span className="whitespace-pre-wrap">{job.instructions}</span>}
              className="sm:col-span-2"
            />
          ) : null}
          <Detail
            label="Required certifications"
            className="sm:col-span-2"
            value={
              requiredSkills.length === 0 ? (
                "None"
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {requiredSkills.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                    >
                      {s.name}
                    </li>
                  ))}
                </ul>
              )
            }
          />
          {assignee ? (
            <Detail
              label="Assigned to"
              className="sm:col-span-2"
              value={
                <span>
                  <Link
                    href={`/admin/contractors/${assignee.id}`}
                    className="font-medium text-blue-700"
                  >
                    {assignee.full_name}
                  </Link>{" "}
                  <span className="text-slate-500">{formatPhone(assignee.phone)}</span>
                  {job.assigned_at ? (
                    <span className="text-slate-500"> · {formatRelative(job.assigned_at)}</span>
                  ) : null}
                </span>
              }
            />
          ) : null}
        </dl>
      </Card>

      {lineItems.length > 0 ? (
        <Card>
          <CardHeader
            title="Work items"
            description="How the contractor payment was built. Each row keeps the rate it was priced at."
          />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineItems.map((li) => (
                  <tr key={li.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-900">{li.description}</span>
                      {li.code ? (
                        <span className="ml-2 font-mono text-[11px] text-slate-400">
                          {li.code}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {Number(li.quantity)} {li.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {formatMoney(li.unit_price_cents, job.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-900">
                      {formatMoney(li.line_total_cents, job.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={3} className="px-4 py-2.5 text-right font-medium text-slate-700">
                    Contractor pay
                  </td>
                  <td className="px-4 py-2.5 text-right text-base font-bold tabular-nums text-slate-900">
                    {formatMoney(job.contractor_pay_cents, job.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ) : null}

      {canDispatch ? (
        <DispatchPanel jobId={id} matches={matches} jobStatus={job.status} />
      ) : null}

      {questions.length > 0 ? (
        <Card>
          <CardHeader title="Questions from contractors" />
          <ul className="divide-y divide-slate-100">
            {questions.map((o) => (
              <li key={o.id} className="px-4 py-3 sm:px-5">
                <p className="text-sm text-slate-900">{o.question}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {o.contractor?.full_name} · {formatPhone(o.contractor?.phone ?? null)} ·{" "}
                  {formatRelative(o.question_at)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {offers.length > 0 ? (
        <Card>
          <CardHeader
            title="Offers"
            description={`Round ${job.offer_round} · ${currentRoundOffers.length} contractor(s) in the current round`}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Contractor</th>
                  <th className="px-4 py-2 font-medium">Round</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Sent</th>
                  <th className="px-4 py-2 font-medium">Responded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="font-medium text-slate-900">
                        {offer.contractor?.full_name ?? "—"}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {formatPhone(offer.contractor?.phone ?? null)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{offer.round}</td>
                    <td className="px-4 py-2.5">
                      <OfferStatusBadge status={offer.status} />
                      {offer.failure_reason ? (
                        <span className="mt-1 block max-w-xs text-xs text-rose-600">
                          {offer.failure_reason}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                      {formatRelative(offer.sent_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                      {formatRelative(offer.responded_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {(beforePhotos.length > 0 || afterPhotos.length > 0 || job.completion_notes || job.field_ticket_ref) ? (
        <Card>
          <CardHeader
            title="Completion"
            description={
              job.completed_at ? `Submitted ${formatRelative(job.completed_at)}` : undefined
            }
          />
          <div className="space-y-4 p-4 sm:p-5">
            {/* The field ticket is the proof of work; anything below it is
                supporting material the contractor chose to add. */}
            {job.field_ticket_ref ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Field ticket
                </p>
                <p className="mt-0.5 font-mono text-base font-semibold text-slate-900">
                  {job.field_ticket_ref}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Check this against the ticket app before approving.
                </p>
              </div>
            ) : null}

            {job.completion_notes ? (
              <Detail
                label="Contractor notes"
                value={<span className="whitespace-pre-wrap">{job.completion_notes}</span>}
              />
            ) : null}

            {(
              [
                ["Before", beforePhotos],
                ["After", afterPhotos],
              ] as const
            ).map(([label, list]) =>
              list.length > 0 ? (
                <div key={label}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {list.map((photo) => (
                      <li key={photo.id}>
                        {photo.url ? (
                          <a href={photo.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.url}
                              alt={photo.caption ?? `${label} photo`}
                              className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200"
                            />
                          </a>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
                            Unavailable
                          </div>
                        )}
                        {photo.caption ? (
                          <p className="mt-1 text-xs text-slate-500">{photo.caption}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </Card>
      ) : null}

      <JobAdminPanels job={job} matches={matches} />

      <Card>
        <CardHeader title="Audit trail" description="Every material action on this job." />
        {audit.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 sm:px-5">
                <span className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">
                    {entry.actor_label ?? "System"}
                  </span>{" "}
                  <span className="font-mono text-xs text-slate-500">{entry.action}</span>
                </span>
                <time className="text-xs text-slate-500">
                  {formatDateTime(entry.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
