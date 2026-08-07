import { InfoBanner } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AppSetting } from "@/lib/types";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase.from("app_settings").select("*").order("key");
  const settings = (data ?? []) as AppSetting[];
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pricing settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          The split and the mileage rate live here rather than in the code, so they can
          be changed without a deployment.
        </p>
      </div>

      <InfoBanner>
        Changes apply to jobs priced from now on. Every job records the percentage and
        rate it was quoted at, so nothing here can reprice work a contractor has already
        accepted. These values are visible to administrators only — a contractor who
        knew the percentage could work backwards to the customer price from their own pay.
      </InfoBanner>

      <SettingsForm
        contractorBps={Number(byKey.contractor_percentage_bps?.value ?? 4500)}
        mileageRate={Number(byKey.mileage_rate?.value ?? 0.725)}
        commuterMiles={Number(byKey.commuter_deduction_miles?.value ?? 30)}
      />
    </div>
  );
}
