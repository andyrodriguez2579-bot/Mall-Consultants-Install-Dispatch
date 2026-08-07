import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Job, Skill } from "@/lib/types";
import { JobForm } from "../../job-form";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: job }, { data: skills }, { data: jobSkills }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", id).maybeSingle<Job>(),
    supabase
      .from("skills")
      .select("id, slug, name, description, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase.from("job_skills").select("skill_id").eq("job_id", id),
  ]);

  if (!job) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/jobs/${id}`} className="text-sm font-medium text-blue-700">
          ← {job.job_number}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Edit job</h1>
      </div>

      <JobForm
        skills={(skills ?? []) as Skill[]}
        job={job}
        selectedSkillIds={((jobSkills ?? []) as Array<{ skill_id: string }>).map(
          (s) => s.skill_id,
        )}
      />
    </div>
  );
}
