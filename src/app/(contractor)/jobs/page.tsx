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
import { type BoardJob, BoardCard } from "./board-card";

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

  const [
    { data: offerRows },
    { data: assignedRows },
    { data: historyRows },
    { data: boardRows },
    { data: recentOfferRows },
  ] = await Promise.all([
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
      // The open board. Named columns, not *: the street address and the site
      // contact live on these rows and are released on claiming, not before.
      supabase
        .from("jobs")
        .select(
          "id, title, site_name, city, state_code, postal_code, scope, contractor_pay_cents, currency, scheduled_start, deadline_at",
        )
        .not("board_posted_at", "is", null)
        .is("assigned_contractor_id", null)
        .in("status", ["ready", "offered", "unfilled"])
        .order("board_posted_at", { ascending: false })
        .limit(50),
      // A week of offers, to work out which of them went to somebody else.
      // Named columns rather than *, because a job this contractor did not win
      // has no reason to put its street address and site contact into a page
      // payload -- the approximate location is all that is ever shown.
      supabase
        .from("job_offers")
        .select(
          "id, created_at, job:job_id(id, title, site_name, city, state_code, postal_code, contractor_pay_cents, currency, assigned_contractor_id)",
        )
        .eq("contractor_id", user.id)
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

  type OfferWithJob = JobOffer & { job: Job | null };
  const offers = ((offerRows ?? []) as unknown as OfferWithJob[]).filter(
    // Hide offers for jobs someone else already won.
    (o) => o.job && o.job.status === "offered",
  );
  const assigned = (assignedRows ?? []) as Job[];
  const history = (historyRows ?? []) as Job[];
  const board = (boardRows ?? []) as BoardJob[];

  /**
   * Jobs offered to this contractor that somebody else took.
   *
   * Shown because an offer that simply vanishes teaches nothing, while a short
   * list of work that went in a few hours is the clearest argument for
   * answering the next text quickly. Deduplicated by job, since a job offered
   * over several rounds produces an offer row for each.
   *
   * Who took it is never displayed, and could not be: row-level security lets a
   * contractor read exactly one profile row, their own, so the winner's name is
   * not reachable from this page even by mistake.
   */
  type TakenJob = Pick<
    Job,
    | "id"
    | "title"
    | "site_name"
    | "city"
    | "state_code"
    | "postal_code"
    | "contractor_pay_cents"
    | "currency"
    | "assigned_contractor_id"
  >;

  const takenByOthers = [
    ...new Map(
      ((recentOfferRows ?? []) as unknown as Array<{ job: TakenJob | null }>)
        .filter(
          (o) =>
            o.job?.assigned_contractor_id &&
            o.job.assigned_contractor_id !== user.id,
        )
        .map((o) => [o.job!.id, o.job!]),
    ).values(),
  ].slice(0, 8);

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

      {board.length > 0 ? <BoardCard jobs={board} /> : null}

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

      {/* Deliberately not links and deliberately grey: there is nothing to do
          with these, and a row that invites a tap only to refuse it is worse
          than one that plainly reads as gone. The pay stays on, because the
          amount is the entire point of showing them. */}
      {takenByOthers.length > 0 ? (
        <Card>
          <CardHeader
            title="Recently taken"
            description="Offered to you in the last week and picked up by someone else. Offers go to everyone qualified at once, first to accept gets it."
          />
          <ul className="divide-y divide-slate-100">
            {takenByOthers.map((job) => (
              <li
                key={job.id}
                className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-500">
                    {job.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatApproximateLocation(job)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums text-slate-500">
                    {formatMoney(job.contractor_pay_cents, job.currency)}
                  </span>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    Taken
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

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
