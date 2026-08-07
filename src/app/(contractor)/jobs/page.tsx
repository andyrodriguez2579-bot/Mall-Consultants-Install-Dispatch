import Link from "next/link";
import { Card, CardHeader, EmptyState, InfoBanner, JobStatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import {
  formatApproximateLocation,
  formatDateTime,
  formatMoney,
  formatRelative,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobOffer } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContractorJobsPage() {
  const user = await requireRole("contractor");
  const supabase = await createClient();

  if (user.contractor?.status !== "approved") {
    return (
      <InfoBanner>
        {user.contractor?.status === "suspended"
          ? "Your account is currently suspended, so you are not receiving job offers. Contact your dispatcher."
          : "Your account is pending approval. You will start receiving job offers by text once it is approved."}
      </InfoBanner>
    );
  }

  const nowIso = new Date().toISOString();

  const [{ data: offerRows }, { data: assignedRows }, { data: historyRows }] =
    await Promise.all([
      // Live offers: still open, still mine to answer.
      supabase
        .from("job_offers")
        .select("*, job:job_id(*)")
        .eq("contractor_id", user.id)
        .in("status", ["pending", "sent", "delivered", "viewed"])
        .gt("expires_at", nowIso)
        .order("expires_at"),
      supabase
        .from("jobs")
        .select("*")
        .eq("assigned_contractor_id", user.id)
        .in("status", ["assigned", "in_progress", "needs_rework", "completed"])
        .order("scheduled_start", { nullsFirst: false }),
      supabase
        .from("jobs")
        .select("*")
        .eq("assigned_contractor_id", user.id)
        .in("status", ["approved", "paid"])
        .order("completed_at", { ascending: false })
        .limit(20),
    ]);

  type OfferWithJob = JobOffer & { job: Job | null };
  const offers = ((offerRows ?? []) as unknown as OfferWithJob[]).filter(
    // Hide offers for jobs someone else already won.
    (o) => o.job && o.job.status === "offered",
  );
  const assigned = (assignedRows ?? []) as Job[];
  const history = (historyRows ?? []) as Job[];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">My jobs</h1>

      <Card>
        <CardHeader
          title="Available now"
          description={
            offers.length > 0 ? "First eligible contractor to accept is assigned." : undefined
          }
        />
        {offers.length === 0 ? (
          <EmptyState
            title="No open offers"
            description="We will text you as soon as a job matching your certifications is posted."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {offers.map((offer) => (
              <li key={offer.id}>
                <Link
                  href={`/jobs/offer/${offer.id}`}
                  className="block px-4 py-4 hover:bg-slate-50 sm:px-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {offer.job!.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatApproximateLocation(offer.job!)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-amber-700">
                        Expires {formatRelative(offer.expires_at)}
                      </p>
                    </div>
                    <span className="shrink-0 text-base font-bold tabular-nums text-slate-900">
                      {formatMoney(offer.job!.contractor_pay_cents, offer.job!.currency)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Assigned to me" />
        {assigned.length === 0 ? (
          <EmptyState title="Nothing assigned right now" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {assigned.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="block px-4 py-4 hover:bg-slate-50 sm:px-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{job.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {job.job_number}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {formatDateTime(job.scheduled_start)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <JobStatusBadge status={job.status} />
                      <span className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatMoney(job.contractor_pay_cents, job.currency)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {history.length > 0 ? (
        <Card>
          <CardHeader title="Approved and paid" />
          <ul className="divide-y divide-slate-100">
            {history.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{job.job_number}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(job.contractor_pay_cents, job.currency)}
                    </span>
                    <JobStatusBadge status={job.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
