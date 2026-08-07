"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readMulti } from "@/lib/validation";

export interface AccountState {
  error?: string;
  success?: string;
}

/**
 * Contractor self-service.
 *
 * Availability, SMS preference, travel radius, certifications and coverage are
 * all the contractor's to manage. Approval standing is not, and the database
 * refuses it independently of this code (see enforce_contractor_self_service).
 */
export async function updateAvailability(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const user = await requireRole("contractor");
  const supabase = await createClient();

  const maxTravelRaw = formData.get("max_travel_miles");
  const maxTravel =
    typeof maxTravelRaw === "string" && maxTravelRaw.trim() !== ""
      ? Number(maxTravelRaw)
      : null;

  if (maxTravel !== null && (!Number.isFinite(maxTravel) || maxTravel < 0 || maxTravel > 5000)) {
    return { error: "Travel radius must be between 0 and 5000 miles." };
  }

  const { error } = await supabase
    .from("contractors")
    .update({
      is_available: formData.get("is_available") === "on",
      sms_opt_in: formData.get("sms_opt_in") === "on",
      max_travel_miles: maxTravel === null ? null : Math.round(maxTravel),
      company_name: (formData.get("company_name") as string)?.trim() || null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/account");
  return { success: "Saved." };
}

export async function updateSkills(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const user = await requireRole("contractor");
  const supabase = await createClient();
  const skillIds = readMulti(formData, "skill_ids");

  // Replace the whole set: simpler than diffing, and the list is short.
  const { error: deleteError } = await supabase
    .from("contractor_skills")
    .delete()
    .eq("contractor_id", user.id);

  if (deleteError) return { error: deleteError.message };

  if (skillIds.length > 0) {
    const { error } = await supabase
      .from("contractor_skills")
      .insert(skillIds.map((skill_id) => ({ contractor_id: user.id, skill_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/account");
  return { success: "Certifications updated." };
}

export async function updateServiceAreas(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const user = await requireRole("contractor");
  const supabase = await createClient();
  const areaIds = readMulti(formData, "service_area_ids");

  const { error: deleteError } = await supabase
    .from("contractor_service_areas")
    .delete()
    .eq("contractor_id", user.id);

  if (deleteError) return { error: deleteError.message };

  if (areaIds.length > 0) {
    const { error } = await supabase
      .from("contractor_service_areas")
      .insert(areaIds.map((service_area_id) => ({ contractor_id: user.id, service_area_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/account");
  return { success: "Service areas updated." };
}
