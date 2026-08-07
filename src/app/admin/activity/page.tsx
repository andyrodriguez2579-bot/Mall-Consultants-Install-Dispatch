import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AuditEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page = "1" } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = 100;

  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .range((pageNum - 1) * pageSize, pageNum * pageSize - 1);

  const entries = (data ?? []) as AuditEntry[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Activity</h1>
        <p className="mt-1 text-sm text-slate-600">
          Append-only audit trail. Entries cannot be edited or deleted by anyone,
          including administrators.
        </p>
      </div>

      <Card>
        <CardHeader title={`Page ${pageNum}`} />
        {entries.length === 0 ? (
          <EmptyState title="Nothing recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                      {formatDateTime(entry.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="font-medium text-slate-900">
                        {entry.actor_label ?? "System"}
                      </span>
                      {entry.actor_role ? (
                        <span className="ml-1 text-xs text-slate-500">({entry.actor_role})</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-700">
                      {entry.entity_type === "job" && entry.entity_id ? (
                        <Link href={`/admin/jobs/${entry.entity_id}`} className="text-blue-700">
                          {entry.action}
                        </Link>
                      ) : (
                        entry.action
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      <span className="line-clamp-2 font-mono">
                        {JSON.stringify(entry.detail)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        {pageNum > 1 ? (
          <Link href={`/admin/activity?page=${pageNum - 1}`} className="text-sm font-medium text-blue-700">
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {entries.length === pageSize ? (
          <Link href={`/admin/activity?page=${pageNum + 1}`} className="text-sm font-medium text-blue-700">
            Older →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
