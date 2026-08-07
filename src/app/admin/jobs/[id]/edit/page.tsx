import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobPricing, PriceListItem, Skill } from "@/lib/types";
import type { PricingDefaults } from "@/components/pricing-panel";
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

  const [{ data: job }, { data: skills }, { data: jobSkills }, { data: priceList }, { data: pricing }] =
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
      supabase.from("job_pricing").select("*").eq("job_id", id).maybeSingle<JobPricing>(),
    ]);

  if (!job) notFound();

  // The job keeps the percentage it was priced at, so an edit never silently
  // re-splits it at today's setting.
  const pricingDefaults: PricingDefaults = {
    serviceItemId: job.service_item_id,
    customerLaborPriceCents: pricing?.customer_labor_price_cents,
    taskCount: pricing ? Number(pricing.task_count) : 1,
    additionalLaborCents: pricing?.additional_labor_cents,
    additionalLaborReason: pricing?.additional_labor_reason,
    contractorBps: pricing?.contractor_percentage_bps,
    contractorMiles: Number(job.contractor_miles),
    excludedMiles: Number(job.excluded_miles),
    mileageRate: Number(job.mileage_rate),
    estimatedMiles: job.estimated_miles === null ? null : Number(job.estimated_miles),
    materialsCents: job.materials_cents,
    tollsParkingCents: job.tolls_parking_cents,
    hotelCents: job.hotel_cents,
    otherExpensesCents: job.other_expenses_cents,
  };

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
        pricingDefaults={pricingDefaults}
      />
    </div>
  );
}
