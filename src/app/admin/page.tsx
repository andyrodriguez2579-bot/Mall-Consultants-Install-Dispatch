import Link from "next/link";
import { Card, CardHeader, EmptyState, JobStatusBadge, StatCard } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui";
import type { AuditEntry, Job, JobStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Statuses that mean "somebody needs to do something about this". */
const NEEDS_ATTENTION: JobStatus[] = ["completed", "unfilled", "needs_rework", "on_hold"];

export default async function AdminDashboard() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: jobs }, { data: activity }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_number, status, title, customer_name, city, state_code, contractor_pay_cents, currency, offer_expires_at, created_at, completed_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const all = (jobs ?? []) as Array<
    Pick<
      Job,
      | "id"
      | "job_number"
      | "status"
      | "title"
      | "customer_name"
      | "city"
      | "state_code"
      | "contractor_pay_cents"
      | "currency"
      | "offer_expires_at"
      | "created_at"
      | "completed_at"
    >
  >;

  const count = (statuses: JobStatus[]) =>
    all.filter((j) => statuses.includes(j.status)).length;

  const awaitingReview = all.filter((j) => j.status === "completed");
  const liveOffers = all.filter((j) => j.status === "offered");
  const attention = all.filter((j) => NEEDS_ATTENTION.includes(j.status));

  // Money owed: approved but not yet paid.
  const owedCents = all
    .filter((j) => j.status === "approved")
    .reduce((sum, j) => sum + j.contractor_pay_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <Link href="/admin/jobs/new" className={buttonClass("primary") + " tap"}>
          Post a job
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Live offers" value={liveOffers.length} tone="warn" href="/admin/jobs?status=offered" />
        <StatCard label="Assigned" value={count(["assigned"])} href="/admin/jobs?status=assigned" />
        <StatCard label="In progress" value={count(["in_progress"])} href="/admin/jobs?status=in_progress" />
        <StatCard label="Awaiting review" value={awaitingReview.length} tone="warn" href="/admin/jobs?status=completed" />
        <StatCard label="Unfilled" value={count(["unfilled"])} tone="warn" href="/admin/jobs?status=unfilled" />
        <StatCard label="Owed" value={formatMoney(owedCents)} tone="good" href="/admin/jobs?status=approved" />
      </dl>

      {attention.length > 0 ? (
        <Card>
          <CardHeader
            title="Needs your attention"
            description="Completed work to review, and jobs nobody has taken."
          />
          <ul className="divide-y divide-slate-100">
            {attention.slice(0, 8).map((job) => (
              <li key={job.id}>
                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {job.title}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {job.job_number} · {job.customer_name}
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {liveOffers.length > 0 ? (
        <Card>
          <CardHeader title="Open dispatch rounds" description="Waiting on a contractor to accept." />
          <ul className="divide-y divide-slate-100">
            {liveOffers.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {job.job_number} · {job.city}, {job.state_code}
                    </p>
                  </div>
                  <p className="text-xs font-medium text-amber-700">
                    Expires {formatRelative(job.offer_expires_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Recent activity"
          description="Every material action, straight from the audit log."
          action={
            <Link href="/admin/activity" className="text-sm font-medium text-blue-700">
              View all
            </Link>
          }
        />
        {(activity ?? []).length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {((activity ?? []) as AuditEntry[]).map((entry) => (
              <li key={entry.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-slate-900">
                    <span className="font-medium">{entry.actor_label ?? "System"}</span>{" "}
                    <span className="text-slate-600">{describe(entry)}</span>
                  </p>
                  <time className="text-xs text-slate-500">
                    {formatDateTime(entry.created_at)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Turn an audit row into a readable sentence. */
function describe(entry: AuditEntry): string {
  const detail = entry.detail as Record<string, unknown>;
  const jobNumber = typeof detail.job_number === "string" ? detail.job_number : "a job";

  switch (entry.action) {
    case "job.created":
      return `created ${jobNumber}`;
    case "job.dispatched":
      return `dispatched ${jobNumber} to ${detail.sent ?? 0} contractor(s)`;
    case "job.status_changed":
      return `moved ${jobNumber} from ${detail.from} to ${detail.to}`;
    case "job.assignment_changed":
      return `changed the assignee on ${jobNumber}`;
    case "job.manually_assigned":
      return `manually assigned ${jobNumber}`;
    case "offer.accepted":
      return `accepted ${jobNumber}`;
    case "offer.passed":
      return `passed on an offer`;
    case "offer.question_asked":
      return `asked a question about a job`;
    case "job.rework_requested":
      return `sent ${jobNumber} back for rework`;
    case "job.arrival_confirmed":
      return `confirmed arrival on ${jobNumber}`;
    case "job.pay_changed":
      return `changed the pay on ${jobNumber}`;
    case "job.paid":
      return `recorded payment for ${jobNumber}`;
    case "offers.expired":
      return `expired ${detail.offers ?? 0} stale offer(s)`;
    default:
      return entry.action;
  }
}
