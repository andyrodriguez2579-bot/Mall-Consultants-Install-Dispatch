import { getSessionUser } from "@/lib/auth";
import { centsToDecimal, csvResponse, isoOrBlank, toCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import type { Job, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Job & { assignee: Pick<Profile, "full_name" | "phone" | "email"> | null };

/**
 * Payment register: everything that is owed or has been paid.
 *
 * Amounts come from the job's fixed contractor pay, which the database freezes
 * at dispatch, so this file always agrees with what the contractor accepted.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.profile.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "all";

  const statuses =
    scope === "owed" ? ["approved"] : scope === "paid" ? ["paid"] : ["approved", "paid"];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, assignee:assigned_contractor_id(full_name, phone, email)")
    .in("status", statuses)
    .order("approved_at", { ascending: false })
    .limit(5000);

  if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });

  const jobs = (data ?? []) as unknown as Row[];

  const csv = toCsv(
    [
      "job_number",
      "status",
      "contractor",
      "contractor_phone",
      "contractor_email",
      "amount",
      "currency",
      "customer",
      "completed_at",
      "approved_at",
      "paid_at",
      "payment_reference",
      "payment_method",
    ],
    jobs.map((j) => [
      j.job_number,
      j.status === "paid" ? "paid" : "owed",
      j.assignee?.full_name ?? "",
      j.assignee?.phone ?? "",
      j.assignee?.email ?? "",
      centsToDecimal(j.contractor_pay_cents),
      j.currency,
      j.customer_name,
      isoOrBlank(j.completed_at),
      isoOrBlank(j.approved_at),
      isoOrBlank(j.paid_at),
      j.payment_reference,
      j.payment_method,
    ]),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`payments-${scope}-${stamp}.csv`, csv);
}
