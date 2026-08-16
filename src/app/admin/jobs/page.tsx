import Link from "next/link";
import {
  Card,
  EmptyState,
  ErrorBanner,
  JobStatusBadge,
  buttonClass,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { JOB_STATUS_LABEL, formatDate, formatMoney, formatRelative } from "@/lib/format";
import { profilesByIds } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobStatus, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: string; label: string; statuses?: JobStatus[] }> = [
  { key: "open", label: "Open", statuses: ["ready", "offered", "assigned", "in_progress", "needs_rework", "unfilled", "on_hold"] },
  { key: "offered", label: "Offered", statuses: ["offered"] },
  { key: "assigned", label: "Assigned", statuses: ["assigned"] },
  { key: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { key: "completed", label: "Awaiting review", statuses: ["completed"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "unfilled", label: "Unfilled", statuses: ["unfilled"] },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "all", label: "All" },
];

type JobRow = Pick<
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
  | "scheduled_start"
  | "offer_expires_at"
  | "assigned_contractor_id"
  | "created_at"
> & { assignee: Pick<Profile, "full_name"> | null };

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireAdmin();
  const { status = "open", q = "" } = await searchParams;
  const supabase = await createClient();

  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0]!;

  let query = supabase
    .from("jobs")
    // No embed for the assignee: see profilesByIds in src/lib/people.ts. An
    // unqualified embed here failed the whole query, so every filter -- not
    // just this one -- rendered an empty list.
    .select(
      "id, job_number, status, title, customer_name, city, state_code, contractor_pay_cents, currency, scheduled_start, offer_expires_at, assigned_contractor_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter.statuses) query = query.in("status", filter.statuses);
  if (q.trim()) {
    // Search across the fields an admin actually remembers a job by.
    const term = `%${q.trim()}%`;
    query = query.or(
      `job_number.ilike.${term},title.ilike.${term},customer_name.ilike.${term},city.ilike.${term}`,
    );
  }

  const { data, error } = await query;

  const people = await profilesByIds(
    supabase,
    (data ?? []).map((j) => (j as { assigned_contractor_id: string | null }).assigned_contractor_id),
  );
  const jobs = ((data ?? []) as unknown as JobRow[]).map((j) => ({
    ...j,
    assignee: j.assigned_contractor_id ? (people.get(j.assigned_contractor_id) ?? null) : null,
  })) as JobRow[];

  const exportParams = new URLSearchParams({ status });
  if (q) exportParams.set("q", q);

  return (
    <div className="space-y-5">
      {/* A failed query and an empty result rendered identically, which turned
          "the list is broken" into "there are no jobs". */}
      {error ? <ErrorBanner>Could not load jobs: {error.message}</ErrorBanner> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Jobs</h1>
        <div className="flex gap-2">
          <a
            href={`/admin/export/jobs?${exportParams}`}
            className={buttonClass("secondary") + " tap"}
          >
            Export CSV
          </a>
          <Link href="/admin/jobs/new" className={buttonClass("primary") + " tap"}>
            Post a job
          </Link>
        </div>
      </div>

      <form className="flex gap-2">
        <input type="hidden" name="status" value={status} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search job number, title, customer, city"
          className="block w-full rounded-lg border-0 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-blue-600"
        />
        <button type="submit" className={buttonClass("secondary")}>
          Search
        </button>
      </form>

      <nav className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1.5 pb-1">
          {FILTERS.map((f) => (
            <li key={f.key}>
              <Link
                href={`/admin/jobs?status=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`inline-flex whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${
                  f.key === status
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:text-slate-900"
                }`}
              >
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Card>
        {jobs.length === 0 ? (
          <EmptyState
            title="No jobs here"
            description={
              q
                ? "Nothing matched that search."
                : `Nothing in ${JOB_STATUS_LABEL[filter.statuses?.[0] ?? "draft"] ?? "this view"} right now.`
            }
            action={
              <Link href="/admin/jobs/new" className={buttonClass("primary") + " tap"}>
                Post a job
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="block px-4 py-3.5 hover:bg-slate-50 sm:px-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {job.title}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {job.job_number}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {job.customer_name} · {job.city}, {job.state_code}
                        {job.assignee ? ` · ${job.assignee.full_name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <JobStatusBadge status={job.status} />
                      <span className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatMoney(job.contractor_pay_cents, job.currency)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {job.status === "offered" && job.offer_expires_at
                          ? `Expires ${formatRelative(job.offer_expires_at)}`
                          : job.scheduled_start
                            ? formatDate(job.scheduled_start)
                            : formatDate(job.created_at)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
