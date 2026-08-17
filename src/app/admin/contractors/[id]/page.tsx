import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, Detail, EmptyState, JobStatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Contractor, Job, Profile, ServiceArea, Skill } from "@/lib/types";
import { ContractorPanels } from "./contractor-panels";

export const dynamic = "force-dynamic";

export default async function ContractorDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: contractor },
    { data: profile },
    { data: skills },
    { data: areas },
    { data: mySkills },
    { data: myAreas },
    { data: jobs },
    { data: notes },
  ] = await Promise.all([
    supabase.from("contractors").select("*").eq("id", id).maybeSingle<Contractor>(),
    supabase.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
    supabase.from("skills").select("id, slug, name, description, is_active").eq("is_active", true).order("name"),
    supabase
      .from("service_areas")
      .select("id, name, state_code, postal_prefixes, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase.from("contractor_skills").select("skill_id").eq("contractor_id", id),
    supabase.from("contractor_service_areas").select("service_area_id").eq("contractor_id", id),
    supabase
      .from("jobs")
      .select("id, job_number, title, status, contractor_pay_cents, currency, completed_at, paid_at")
      .eq("assigned_contractor_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("contractor_notes")
      .select("id, body, created_at, author_id")
      .eq("contractor_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!contractor || !profile) notFound();

  const jobRows = (jobs ?? []) as Array<
    Pick<Job, "id" | "job_number" | "title" | "status" | "contractor_pay_cents" | "currency" | "completed_at" | "paid_at">
  >;

  const earnedCents = jobRows
    .filter((j) => j.status === "paid")
    .reduce((sum, j) => sum + j.contractor_pay_cents, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/contractors" className="text-sm font-medium text-blue-700">
          ← Contractors
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{profile.full_name}</h1>
        {contractor.company_name ? (
          <p className="text-sm text-slate-600">{contractor.company_name}</p>
        ) : null}
      </div>

      {/* Only what is derived, or decided elsewhere. Everything an admin types
          now lives in the editable panel below, so there is one place to change
          a number rather than a display kept in step with a form. */}
      <Card>
        <CardHeader title="Summary" />
        <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <Detail label="Standing" value={contractor.status} />
          <Detail label="Approved" value={formatDateTime(contractor.approved_at)} />
          <Detail label="Lifetime paid" value={formatMoney(earnedCents)} />
        </dl>
      </Card>

      <ContractorPanels
        contractor={contractor}
        profile={profile}
        skills={(skills ?? []) as Skill[]}
        serviceAreas={(areas ?? []) as ServiceArea[]}
        selectedSkillIds={((mySkills ?? []) as Array<{ skill_id: string }>).map((s) => s.skill_id)}
        selectedAreaIds={((myAreas ?? []) as Array<{ service_area_id: string }>).map(
          (a) => a.service_area_id,
        )}
        notes={
          (notes ?? []) as Array<{ id: string; body: string; created_at: string; author_id: string | null }>
        }
      />

      <Card>
        <CardHeader title="Work history" />
        {jobRows.length === 0 ? (
          <EmptyState title="No jobs yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobRows.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{job.job_number}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(job.contractor_pay_cents, job.currency)}
                    </span>
                    <JobStatusBadge status={job.status} />
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
