"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ContractorStatus } from "@/lib/types";
import { contractorFormSchema, fieldErrors, readMulti } from "@/lib/validation";

export interface ContractorState {
  error?: string;
  errors?: Record<string, string>;
  success?: string;
}

/**
 * Create a contractor.
 *
 * Creates the Supabase auth user as well, because a contractor with no auth
 * user could be texted an offer link and then fail to get a session. The
 * account starts 'pending' -- approval is a separate, deliberate act.
 */
export async function createContractor(
  _prev: ContractorState,
  formData: FormData,
): Promise<ContractorState> {
  await requireAdmin();

  const parsed = contractorFormSchema.safeParse({
    full_name: formData.get("full_name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    company_name: formData.get("company_name") ?? "",
    max_travel_miles: formData.get("max_travel_miles") ?? "",
    skill_ids: readMulti(formData, "skill_ids"),
    service_area_ids: readMulti(formData, "service_area_ids"),
  });

  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const admin = createAdminClient();

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    phone: parsed.data.phone,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });

  if (authError || !created?.user) {
    const duplicate = /already|registered|exists/i.test(authError?.message ?? "");
    return {
      error: duplicate
        ? "A user with that email or phone number already exists."
        : (authError?.message ?? "Could not create the account."),
    };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role: "contractor",
    full_name: parsed.data.full_name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    is_active: true,
  });

  if (profileError) {
    // Roll the auth user back so a half-created contractor cannot linger.
    await admin.auth.admin.deleteUser(userId);
    return { error: profileError.message };
  }

  await admin.from("contractors").insert({
    id: userId,
    status: "pending",
    company_name: parsed.data.company_name,
    max_travel_miles: parsed.data.max_travel_miles,
  });

  if (parsed.data.skill_ids.length > 0) {
    await admin
      .from("contractor_skills")
      .insert(parsed.data.skill_ids.map((skill_id) => ({ contractor_id: userId, skill_id })));
  }
  if (parsed.data.service_area_ids.length > 0) {
    await admin
      .from("contractor_service_areas")
      .insert(
        parsed.data.service_area_ids.map((service_area_id) => ({
          contractor_id: userId,
          service_area_id,
        })),
      );
  }

  await admin.rpc("write_audit", {
    p_entity_type: "contractor",
    p_entity_id: userId,
    p_action: "contractor.created",
    p_detail: { full_name: parsed.data.full_name },
  });

  revalidatePath("/admin/contractors");
  return { success: `${parsed.data.full_name} added. Approve them to start dispatching.` };
}

export async function setContractorStatus(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const contractorId = formData.get("contractor_id");
  const status = formData.get("status");

  if (
    typeof contractorId !== "string" ||
    (status !== "approved" && status !== "pending" && status !== "suspended")
  ) {
    return;
  }

  const supabase = await createClient();
  await supabase
    .from("contractors")
    .update({
      status: status as ContractorStatus,
      // The CHECK constraint ties approved_at to the approved state.
      approved_at: status === "approved" ? new Date().toISOString() : null,
      approved_by: status === "approved" ? admin.id : null,
    })
    .eq("id", contractorId);

  const client = createAdminClient();
  await client.rpc("write_audit", {
    p_entity_type: "contractor",
    p_entity_id: contractorId,
    p_action: `contractor.${status}`,
    p_detail: {},
    p_actor_id: admin.id,
  });

  revalidatePath(`/admin/contractors/${contractorId}`);
  revalidatePath("/admin/contractors");
}

export async function updateContractorSkills(
  _prev: ContractorState,
  formData: FormData,
): Promise<ContractorState> {
  await requireAdmin();
  const contractorId = formData.get("contractor_id");
  if (typeof contractorId !== "string") return { error: "Missing contractor." };

  const supabase = await createClient();
  const skillIds = readMulti(formData, "skill_ids");
  const areaIds = readMulti(formData, "service_area_ids");

  await supabase.from("contractor_skills").delete().eq("contractor_id", contractorId);
  if (skillIds.length > 0) {
    await supabase
      .from("contractor_skills")
      .insert(skillIds.map((skill_id) => ({ contractor_id: contractorId, skill_id })));
  }

  await supabase.from("contractor_service_areas").delete().eq("contractor_id", contractorId);
  if (areaIds.length > 0) {
    await supabase
      .from("contractor_service_areas")
      .insert(
        areaIds.map((service_area_id) => ({ contractor_id: contractorId, service_area_id })),
      );
  }

  revalidatePath(`/admin/contractors/${contractorId}`);
  return { success: "Updated." };
}

export async function addContractorNote(
  _prev: ContractorState,
  formData: FormData,
): Promise<ContractorState> {
  const admin = await requireAdmin();
  const contractorId = formData.get("contractor_id");
  const body = formData.get("body");

  if (typeof contractorId !== "string") return { error: "Missing contractor." };
  if (typeof body !== "string" || body.trim().length < 2) {
    return { errors: { body: "Write a note first." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("contractor_notes").insert({
    contractor_id: contractorId,
    author_id: admin.id,
    body: body.trim(),
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/contractors/${contractorId}`);
  return { success: "Note added." };
}
