"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import type { Contractor, ServiceArea, Skill } from "@/lib/types";
import {
  type AccountState,
  updateAvailability,
  updateServiceAreas,
  updateSkills,
} from "./actions";

const EMPTY: AccountState = {};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function AccountForms({
  contractor,
  skills,
  serviceAreas,
  selectedSkillIds,
  selectedAreaIds,
}: {
  contractor: Contractor | null;
  skills: Skill[];
  serviceAreas: ServiceArea[];
  selectedSkillIds: string[];
  selectedAreaIds: string[];
}) {
  const [availState, availAction] = useActionState(updateAvailability, EMPTY);
  const [skillState, skillAction] = useActionState(updateSkills, EMPTY);
  const [areaState, areaAction] = useActionState(updateServiceAreas, EMPTY);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Availability and alerts" />
        <form action={availAction} className="space-y-4 p-4 sm:p-5">
          {availState.error ? <ErrorBanner>{availState.error}</ErrorBanner> : null}
          {availState.success ? <SuccessBanner>{availState.success}</SuccessBanner> : null}

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="is_available"
              defaultChecked={contractor?.is_available ?? true}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                Available for work
              </span>
              <span className="block text-xs text-slate-500">
                Turn this off and you stop appearing in dispatch lists.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="sms_opt_in"
              defaultChecked={contractor?.sms_opt_in ?? true}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                Text me about new jobs
              </span>
              <span className="block text-xs text-slate-500">
                Offers are first-come, so turning this off means you will usually miss them.
              </span>
            </span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-800">Business name</span>
            <input
              name="company_name"
              defaultValue={contractor?.company_name ?? ""}
              className={inputClass + " mt-1.5"}
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-slate-800">
              Willing to travel (miles)
            </span>
            <input
              name="max_travel_miles"
              type="number"
              min={0}
              max={5000}
              defaultValue={contractor?.max_travel_miles ?? ""}
              className={inputClass + " mt-1.5 w-40"}
            />
          </label>

          <Save />
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Certifications"
          description="You can only accept jobs that require certifications you hold."
        />
        <form action={skillAction} className="space-y-4 p-4 sm:p-5">
          {skillState.error ? <ErrorBanner>{skillState.error}</ErrorBanner> : null}
          {skillState.success ? <SuccessBanner>{skillState.success}</SuccessBanner> : null}

          <div className="space-y-2">
            {skills.map((skill) => (
              <label
                key={skill.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
              >
                <input
                  type="checkbox"
                  name="skill_ids"
                  value={skill.id}
                  defaultChecked={selectedSkillIds.includes(skill.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{skill.name}</span>
                  {skill.description ? (
                    <span className="block text-xs text-slate-500">{skill.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            Your dispatcher verifies certifications against the documents on file.
            Claiming one you do not hold will cost you the assignment.
          </p>

          <Save />
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Service areas"
          description="Where you are willing to work. Used to match you to nearby jobs."
        />
        <form action={areaAction} className="space-y-4 p-4 sm:p-5">
          {areaState.error ? <ErrorBanner>{areaState.error}</ErrorBanner> : null}
          {areaState.success ? <SuccessBanner>{areaState.success}</SuccessBanner> : null}

          <div className="space-y-2">
            {serviceAreas.map((area) => (
              <label
                key={area.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
              >
                <input
                  type="checkbox"
                  name="service_area_ids"
                  value={area.id}
                  defaultChecked={selectedAreaIds.includes(area.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{area.name}</span>
                  <span className="block text-xs text-slate-500">
                    {area.state_code ?? ""}
                    {area.postal_prefixes.length > 0
                      ? ` · ZIPs starting ${area.postal_prefixes.join(", ")}`
                      : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <Save />
        </form>
      </Card>
    </div>
  );
}
