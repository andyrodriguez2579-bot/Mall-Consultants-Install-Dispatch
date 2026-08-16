import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, InfoBanner } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AppSetting, InstallRequest, PriceListItem, Skill } from "@/lib/types";
import type { ParsedRequest } from "@/lib/intake/parse";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

export default async function ReviewRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("install_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle<InstallRequest>();

  if (!request) notFound();

  // A converted request is just a pointer to its job.
  if (request.status === "converted" && request.job_id) {
    redirect(`/admin/jobs/${request.job_id}`);
  }

  const [{ data: priceList }, { data: skills }, { data: settings }] = await Promise.all([
    supabase
      .from("price_list_items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("skills")
      .select("id, slug, name, description, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase.from("app_settings").select("*"),
  ]);

  const byKey = Object.fromEntries(((settings ?? []) as AppSetting[]).map((s) => [s.key, s]));

  const parsed = request.parsed as unknown as ParsedRequest;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/requests" className="text-sm font-medium text-blue-700">
          ← Install requests
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Review request</h1>
        <p className="mt-1 text-sm text-slate-600">
          Received {formatDateTime(request.received_at)} · {request.source}
        </p>
      </div>

      {request.status === "discarded" ? (
        <InfoBanner>
          This request was discarded
          {request.discard_reason ? `: ${request.discard_reason}` : "."}
        </InfoBanner>
      ) : null}

      {parsed?.missing?.length > 0 ? (
        <InfoBanner>
          <span className="font-semibold">Could not read:</span>{" "}
          {parsed.missing.join(", ")}. Fill these in below before creating the job.
        </InfoBanner>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader
            title="As received"
            description="Kept verbatim. This is the record of what was asked for."
          />
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[13px] leading-relaxed text-slate-700 sm:px-5">
            {request.raw_text}
          </pre>
        </Card>

        <ReviewForm
          details={parsed?.details ?? { items: [], notes: [] }}
          requestId={request.id}
          parsed={parsed}
          priceList={(priceList ?? []) as PriceListItem[]}
          skills={(skills ?? []) as Skill[]}
          contractorBps={Number(byKey.contractor_percentage_bps?.value ?? 4500)}
          mileageRate={Number(byKey.mileage_rate?.value ?? 0.725)}
          commuterMiles={Number(byKey.commuter_deduction_miles?.value ?? 30)}
        />
      </div>
    </div>
  );
}
