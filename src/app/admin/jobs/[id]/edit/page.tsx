import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobLineItem, PriceListItem, Skill } from "@/lib/types";
import type { EditableLineItem } from "@/components/line-item-editor";
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

  const [{ data: job }, { data: skills }, { data: jobSkills }, { data: priceList }, { data: lineItems }] =
    await Promise.all([
      supabase.from("jobs").select("*").eq("id", id).maybeSingle<Job>(),
      supabase
        .from("skills")
        .select("id, slug, name, description, is_active")
        .eq("is_active", true)
        .order("name"),
      supabase.from("job_skills").select("skill_id").eq("job_id", id),
      supabase
        .from("price_list_items")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase.from("job_line_items").select("*").eq("job_id", id).order("sort_order"),
    ]);

  if (!job) notFound();

  // Existing rows keep the description and rate they were priced at, not
  // whatever the catalogue says today.
  const initialLineItems: EditableLineItem[] = ((lineItems ?? []) as JobLineItem[]).map(
    (li) => ({
      key: li.id,
      price_list_item_id: li.price_list_item_id,
      code: li.code,
      description: li.description,
      unit: li.unit,
      unit_price_cents: li.unit_price_cents,
      quantity: Number(li.quantity),
    }),
  );

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
        priceList={(priceList ?? []) as PriceListItem[]}
        job={job}
        selectedSkillIds={((jobSkills ?? []) as Array<{ skill_id: string }>).map(
          (s) => s.skill_id,
        )}
        initialLineItems={initialLineItems}
      />
    </div>
  );
}
