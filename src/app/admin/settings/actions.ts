"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface SettingsState {
  error?: string;
  success?: string;
}

/** Bounds that keep a typo from silently repricing every future job. */
const LIMITS: Record<string, { min: number; max: number; label: string }> = {
  contractor_percentage_bps: { min: 0, max: 10000, label: "Contractor percentage" },
  mileage_rate: { min: 0, max: 10, label: "Mileage rate" },
  commuter_deduction_miles: { min: 0, max: 500, label: "Commuter deduction" },
};

/**
 * Update the pricing settings.
 *
 * These apply to jobs priced from now on. Existing jobs keep the percentage and
 * rate they were quoted at -- the job snapshots both -- so changing a number
 * here can never reprice work a contractor has already accepted.
 */
export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const updates: Array<{ key: string; value: number }> = [];

  for (const [key, limit] of Object.entries(LIMITS)) {
    const raw = formData.get(key);
    if (typeof raw !== "string" || raw.trim() === "") continue;

    // The contractor percentage is entered as a percentage and stored as basis
    // points, so "45" cannot be mistaken for 0.45.
    const entered = Number(raw);
    if (!Number.isFinite(entered)) {
      return { error: `${limit.label} must be a number.` };
    }

    const value = key === "contractor_percentage_bps" ? Math.round(entered * 100) : entered;

    if (value < limit.min || value > limit.max) {
      return {
        error:
          key === "contractor_percentage_bps"
            ? "Contractor percentage must be between 0 and 100."
            : `${limit.label} must be between ${limit.min} and ${limit.max}.`,
      };
    }

    updates.push({ key, value });
  }

  for (const { key, value } of updates) {
    const { error } = await supabase
      .from("app_settings")
      .update({ value, updated_by: admin.id, updated_at: new Date().toISOString() })
      .eq("key", key);

    if (error) return { error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: "Saved. New jobs will be priced with these values." };
}
