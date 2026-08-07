import Link from "next/link";
import { Card, CardHeader, EmptyState, InfoBanner, buttonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Job, Profile } from "@/lib/types";
import { PaymentRunForm } from "./payment-run-form";

export const dynamic = "force-dynamic";

export interface PayableJob {
  id: string;
  job_number: string;
  title: string;
  customer_name: string;
  contractor_pay_cents: number;
  currency: string;
  approved_at: string | null;
  scheduled_pay_date: string | null;
  assignee: Pick<Profile, "id" | "full_name"> | null;
}

/** The coming Friday, matching next_friday() in the database. */
function nextFriday(from = new Date()): string {
  const d = new Date(from);
  const shift = (5 - (d.getDay() === 0 ? 7 : d.getDay()) + 7) % 7;
  d.setDate(d.getDate() + shift);
  return d.toISOString().slice(0, 10);
}

export default async function PaymentsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: approved }, { data: recent }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_number, title, customer_name, contractor_pay_cents, currency, approved_at, scheduled_pay_date, assignee:assigned_contractor_id(id, full_name)",
      )
      .eq("status", "approved")
      .order("scheduled_pay_date", { nullsFirst: false })
      .limit(500),
    supabase
      .from("jobs")
      .select(
        "id, job_number, title, contractor_pay_cents, currency, paid_at, payment_reference, assignee:assigned_contractor_id(id, full_name)",
      )
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(25),
  ]);

  const payable = (approved ?? []) as unknown as PayableJob[];
  const paid = (recent ?? []) as unknown as Array<
    Pick<Job, "id" | "job_number" | "title" | "contractor_pay_cents" | "currency" | "paid_at" | "payment_reference"> & {
      assignee: Pick<Profile, "id" | "full_name"> | null;
    }
  >;

  // Group by the Friday each job was scheduled into. Anything scheduled for a
  // past Friday is still owed, so it is surfaced first rather than hidden.
  const groups = new Map<string, PayableJob[]>();
  for (const job of payable) {
    const key = job.scheduled_pay_date ?? nextFriday();
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  const totalOwed = payable.reduce((sum, j) => sum + j.contractor_pay_cents, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Payments</h1>
          <p className="mt-1 text-sm text-slate-600">
            Contractors are paid on Fridays. Approving work schedules it into the next run.
          </p>
        </div>
        <a href="/admin/export/payments?scope=owed" className={buttonClass("secondary") + " tap"}>
          Export owed
        </a>
      </div>

      <InfoBanner>
        Payments are made outside this system. Recording a run here marks the jobs paid,
        texts each contractor, and writes it to the audit log — it does not move money.
        Amounts always come from the pay the contractor accepted.
      </InfoBanner>

      {payable.length === 0 ? (
        <Card>
          <CardHeader title="Nothing owed" />
          <EmptyState
            title="No approved work waiting for payment"
            description="Approved jobs appear here, grouped into the Friday they are due."
          />
        </Card>
      ) : (
        <>
          <div className="rounded-xl bg-slate-900 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Total owed
            </p>
            <p className="mt-0.5 text-3xl font-bold tabular-nums text-white">
              {formatMoney(totalOwed)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              across {payable.length} approved job{payable.length === 1 ? "" : "s"}
            </p>
          </div>

          {sortedGroups.map(([payDate, jobs]) => (
            <PaymentRunForm
              key={payDate}
              payDate={payDate}
              jobs={jobs}
              overdue={payDate < today}
            />
          ))}
        </>
      )}

      {paid.length > 0 ? (
        <Card>
          <CardHeader title="Recently paid" />
          <ul className="divide-y divide-slate-100">
            {paid.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="font-mono">{job.job_number}</span>
                      {job.assignee ? ` · ${job.assignee.full_name}` : ""}
                      {job.payment_reference ? ` · ${job.payment_reference}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="block text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(job.contractor_pay_cents, job.currency)}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(job.paid_at)}</span>
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
