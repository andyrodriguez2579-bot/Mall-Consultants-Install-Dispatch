import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { InstallRequest } from "@/lib/types";
import { NewRequestForm } from "./new-request-form";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  new: "bg-amber-50 text-amber-900 ring-amber-300",
  converted: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  discarded: "bg-slate-200 text-slate-600 ring-slate-300",
};

/** First line of the request, for the list summary. */
function summarize(request: InstallRequest): string {
  const parsed = request.parsed as { title?: { value?: string }; customer_name?: { value?: string } };
  if (parsed?.title?.value) return parsed.title.value;
  if (parsed?.customer_name?.value) return parsed.customer_name.value;

  const firstLine = request.raw_text.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine?.slice(0, 90) ?? "Untitled request";
}

export default async function RequestsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("install_requests")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(100);

  const requests = (data ?? []) as InstallRequest[];
  const pending = requests.filter((r) => r.status === "new");
  const handled = requests.filter((r) => r.status !== "new");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Install requests</h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste a request as it arrived. What can be recognised is pulled out for you
          to check, and the original text is kept alongside the job.
        </p>
      </div>

      <NewRequestForm />

      <Card>
        <CardHeader
          title="Awaiting review"
          description={pending.length > 0 ? `${pending.length} to turn into jobs` : undefined}
        />
        {pending.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Paste a request above to start one." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/admin/requests/${request.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {summarize(request)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Received {formatRelative(request.received_at)} · {request.source}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[request.status]}`}
                  >
                    Review
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {handled.length > 0 ? (
        <Card>
          <CardHeader title="Handled" />
          <ul className="divide-y divide-slate-100">
            {handled.map((request) => (
              <li key={request.id}>
                <Link
                  href={
                    request.job_id
                      ? `/admin/jobs/${request.job_id}`
                      : `/admin/requests/${request.id}`
                  }
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{summarize(request)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatRelative(request.received_at)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[request.status]}`}
                  >
                    {request.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
