import { getSessionUser } from "@/lib/auth";
import { centsToDecimal, csvResponse, isoOrBlank, toCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobStatus, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

const GROUPS: Record<string, JobStatus[] | undefined> = {
  open: ["ready", "offered", "assigned", "in_progress", "needs_rework", "unfilled", "on_hold"],
  offered: ["offered"],
  assigned: ["assigned"],
  in_progress: ["in_progress"],
  completed: ["completed"],
  approved: ["approved"],
  paid: ["paid"],
  unfilled: ["unfilled"],
  draft: ["draft"],
  all: undefined,
};

type Row = Job & { assignee: Pick<Profile, "full_name" | "phone"> | null };

/** CSV export of jobs, honouring the same filters as the jobs list. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  // A route handler has no redirect to fall back on, so refuse plainly.
  if (!user || user.profile.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "all";
  const q = url.searchParams.get("q") ?? "";

  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select("*, assignee:assigned_contractor_id(full_name, phone)")
    .order("created_at", { ascending: false })
    .limit(5000);

  const statuses = GROUPS[status];
  if (statuses) query = query.in("status", statuses);
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(
      `job_number.ilike.${term},title.ilike.${term},customer_name.ilike.${term},city.ilike.${term}`,
    );
  }

  const { data, error } = await query;
  if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });

  const jobs = (data ?? []) as unknown as Row[];

  const csv = toCsv(
    [
      "job_number",
      "status",
      "title",
      "customer",
      "site",
      "address",
      "city",
      "state",
      "postal_code",
      "contractor_pay",
      "currency",
      "assigned_to",
      "assigned_phone",
      "scheduled_start",
      "scheduled_end",
      "deadline",
      "assigned_at",
      "started_at",
      "completed_at",
      "approved_at",
      "paid_at",
      "payment_reference",
      "payment_method",
      "rework_count",
      "created_at",
    ],
    jobs.map((j) => [
      j.job_number,
      j.status,
      j.title,
      j.customer_name,
      j.site_name,
      [j.address_line1, j.address_line2].filter(Boolean).join(" "),
      j.city,
      j.state_code,
      j.postal_code,
      centsToDecimal(j.contractor_pay_cents),
      j.currency,
      j.assignee?.full_name ?? "",
      j.assignee?.phone ?? "",
      isoOrBlank(j.scheduled_start),
      isoOrBlank(j.scheduled_end),
      isoOrBlank(j.deadline_at),
      isoOrBlank(j.assigned_at),
      isoOrBlank(j.started_at),
      isoOrBlank(j.completed_at),
      isoOrBlank(j.approved_at),
      isoOrBlank(j.paid_at),
      j.payment_reference,
      j.payment_method,
      j.rework_count,
      j.created_at,
    ]),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`jobs-${status}-${stamp}.csv`, csv);
}
