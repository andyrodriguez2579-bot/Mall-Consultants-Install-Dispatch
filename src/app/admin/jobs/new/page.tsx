import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Skill } from "@/lib/types";
import { JobForm } from "../job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: skills } = await supabase
    .from("skills")
    .select("id, slug, name, description, is_active")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/jobs" className="text-sm font-medium text-blue-700">
          ← Jobs
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Post a job</h1>
        <p className="mt-1 text-sm text-slate-600">
          Save it as ready, then dispatch it to contractors from the job page.
        </p>
      </div>

      <JobForm skills={(skills ?? []) as Skill[]} />
    </div>
  );
}
