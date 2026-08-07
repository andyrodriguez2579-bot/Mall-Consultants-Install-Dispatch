import { Card, CardHeader, Detail, InfoBanner } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatPhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ServiceArea, Skill } from "@/lib/types";
import { AccountForms } from "./account-forms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireRole("contractor");
  const supabase = await createClient();

  const [{ data: skills }, { data: areas }, { data: mySkills }, { data: myAreas }] =
    await Promise.all([
      supabase.from("skills").select("id, slug, name, description, is_active").eq("is_active", true).order("name"),
      supabase.from("service_areas").select("id, name, state_code, postal_prefixes, is_active").eq("is_active", true).order("name"),
      supabase.from("contractor_skills").select("skill_id").eq("contractor_id", user.id),
      supabase.from("contractor_service_areas").select("service_area_id").eq("contractor_id", user.id),
    ]);

  const status = user.contractor?.status ?? "pending";

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Account</h1>

      {status !== "approved" ? (
        <InfoBanner>
          {status === "suspended"
            ? "Your account is suspended and is not receiving job offers. Contact your dispatcher."
            : "Your account is pending approval. You will begin receiving offers by text once approved."}
        </InfoBanner>
      ) : null}

      <Card>
        <CardHeader title="Your details" description="Contact your dispatcher to change these." />
        <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Detail label="Name" value={user.profile.full_name} />
          <Detail label="Mobile" value={formatPhone(user.profile.phone)} />
          <Detail label="Email" value={user.profile.email ?? "—"} />
          <Detail
            label="Standing"
            value={
              status === "approved" ? "Approved" : status === "pending" ? "Pending approval" : "Suspended"
            }
          />
        </dl>
      </Card>

      <AccountForms
        contractor={user.contractor}
        skills={(skills ?? []) as Skill[]}
        serviceAreas={(areas ?? []) as ServiceArea[]}
        selectedSkillIds={((mySkills ?? []) as Array<{ skill_id: string }>).map((s) => s.skill_id)}
        selectedAreaIds={((myAreas ?? []) as Array<{ service_area_id: string }>).map(
          (a) => a.service_area_id,
        )}
      />
    </div>
  );
}
