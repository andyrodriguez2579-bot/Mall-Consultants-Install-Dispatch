import Link from "next/link";
import { Card, CardHeader, EmptyState, ErrorBanner } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Contractor, ContractorStatus, Profile } from "@/lib/types";
import { NewContractorForm } from "./new-contractor-form";
import type { ServiceArea, Skill } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ContractorStatus, string> = {
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  suspended: "bg-rose-50 text-rose-800 ring-rose-200",
};

type Row = Contractor & { profile: Pick<Profile, "full_name" | "phone" | "email" | "is_active"> };

export default async function ContractorsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: rows, error: rowsError }, { data: skills }, { data: areas }] = await Promise.all([
    supabase
      .from("contractors")
      // Named by constraint, not by column. `contractors` references
      // `profiles` twice -- as the person (id) and as whoever approved them
      // (approved_by) -- and an unqualified embed is rejected as ambiguous.
      .select(
        "*, profile:profiles!contractors_id_fkey(full_name, phone, email, is_active)",
      )
      .order("status"),
    supabase.from("skills").select("id, slug, name, description, is_active").eq("is_active", true).order("name"),
    supabase
      .from("service_areas")
      .select("id, name, state_code, postal_prefixes, is_active")
      .eq("is_active", true)
      .order("name"),
  ]);

  const contractors = (rows ?? []) as unknown as Row[];
  const byStatus = (status: ContractorStatus) => contractors.filter((c) => c.status === status);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Contractors</h1>

      {/* A failed query and an empty roster used to render identically, which
          turns "the list is broken" into "nobody is here". Say which it is. */}
      {rowsError ? (
        <ErrorBanner>
          Could not load contractors: {rowsError.message}
        </ErrorBanner>
      ) : null}

      {(["pending", "approved", "suspended"] as ContractorStatus[]).map((status) => {
        const group = byStatus(status);
        if (group.length === 0 && status !== "approved") return null;

        return (
          <Card key={status}>
            <CardHeader
              title={
                status === "approved"
                  ? "Approved"
                  : status === "pending"
                    ? "Pending approval"
                    : "Suspended"
              }
              description={
                status === "approved" ? "Eligible to receive and accept work." : undefined
              }
            />
            {group.length === 0 ? (
              <EmptyState title="Nobody here yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {group.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/contractors/${c.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {c.profile.full_name}
                          {c.company_name ? (
                            <span className="font-normal text-slate-500"> · {c.company_name}</span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatPhone(c.profile.phone)}
                          {!c.is_available ? " · unavailable" : ""}
                          {!c.sms_opt_in ? " · SMS off" : ""}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_TONE[c.status]}`}
                      >
                        {c.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      <NewContractorForm
        skills={(skills ?? []) as Skill[]}
        serviceAreas={(areas ?? []) as ServiceArea[]}
      />
    </div>
  );
}
