import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMoneyToCents } from "./format";

/**
 * Reading the pricing panel's submission and writing it to the two tables it
 * spans: the contractor-facing figures on `jobs`, and the customer-side money
 * in `job_pricing`.
 *
 * Kept in one place so job creation, job editing and request conversion cannot
 * drift apart on how a job gets priced.
 */

const cents = (formData: FormData, name: string): number => {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  return parseMoneyToCents(raw) ?? 0;
};

const num = (formData: FormData, name: string, fallback = 0): number => {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const text = (formData: FormData, name: string): string | null => {
  const raw = formData.get(name);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
};

export interface PricingSubmission {
  /** Goes on `jobs` -- readable by the assigned or offered contractor. */
  jobFields: {
    service_item_id: string | null;
    service_type: string | null;
    contractor_miles: number;
    excluded_miles: number;
    mileage_rate: number;
    estimated_miles: number | null;
    materials_cents: number;
    tolls_parking_cents: number;
    hotel_cents: number;
    other_expenses_cents: number;
  };
  /** Goes on `job_pricing` -- administrators only. */
  pricingFields: {
    customer_labor_price_cents: number;
    task_count: number;
    additional_labor_cents: number;
    additional_labor_reason: string | null;
    /**
     * Per job, so a difficult install can pay above the standard rate without
     * moving every other job. Undefined when the form does not supply it,
     * which leaves the column default -- the global setting -- in place.
     */
    contractor_percentage_bps?: number;
  };
  /**
   * A percentage was typed but could not be read. Distinguished from "not
   * supplied" so a typo becomes an error the administrator sees rather than a
   * silent fall back to the standard rate.
   */
  invalidPercentage: boolean;
}

/** A percentage typed as "45" or "52.5", read as basis points. */
function percentageBps(formData: FormData, name: string): number | undefined {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100);
}

export function readPricingForm(formData: FormData): PricingSubmission {
  const additional = cents(formData, "additional_labor");
  const rawShare = formData.get("contractor_percentage");
  const shareSupplied = typeof rawShare === "string" && rawShare.trim() !== "";
  const bps = percentageBps(formData, "contractor_percentage");

  return {
    invalidPercentage: shareSupplied && bps === undefined,
    jobFields: {
      service_item_id: text(formData, "service_item_id"),
      service_type: text(formData, "service_type"),
      contractor_miles: num(formData, "contractor_miles"),
      excluded_miles: num(formData, "excluded_miles"),
      mileage_rate: num(formData, "mileage_rate", 0.725),
      estimated_miles: formData.get("estimated_miles") ? num(formData, "estimated_miles") : null,
      materials_cents: cents(formData, "materials"),
      tolls_parking_cents: cents(formData, "tolls_parking"),
      hotel_cents: cents(formData, "hotel"),
      other_expenses_cents: cents(formData, "other_expenses"),
    },
    pricingFields: {
      customer_labor_price_cents: cents(formData, "customer_labor_price"),
      task_count: num(formData, "task_count", 1),
      additional_labor_cents: additional,
      additional_labor_reason: additional > 0 ? text(formData, "additional_labor_reason") : null,
      ...(bps === undefined ? {} : { contractor_percentage_bps: bps }),
    },
  };
}

/** Validation the database also enforces, phrased for a person. */
export function validatePricing(submission: PricingSubmission): Record<string, string> | null {
  const errors: Record<string, string> = {};
  const { customer_labor_price_cents, task_count, additional_labor_cents, additional_labor_reason } =
    submission.pricingFields;

  if (submission.invalidPercentage) {
    errors.contractor_percentage = "The contractor share must be a percentage between 0 and 100.";
  }
  if (customer_labor_price_cents <= 0) {
    errors.customer_labor_price = "Set the customer labor price for this service.";
  }
  if (task_count <= 0) {
    errors.task_count = "There must be at least one task.";
  }
  if (additional_labor_cents > 0 && !additional_labor_reason) {
    errors.additional_labor_reason = "Additional labor needs a reason before it can be approved.";
  }
  if (submission.jobFields.excluded_miles > submission.jobFields.contractor_miles &&
      submission.jobFields.contractor_miles > 0) {
    // Not an error -- it simply pays no mileage -- but worth saying out loud.
    errors.excluded_miles = "Excluded miles exceed the miles driven, so no mileage will be paid.";
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Write the customer side of a job's pricing.
 *
 * Approval of additional labor is stamped here rather than trusted from the
 * form: the database refuses a non-zero additional charge without it.
 */
export async function upsertJobPricing(
  supabase: SupabaseClient,
  jobId: string,
  submission: PricingSubmission,
  adminId: string,
): Promise<{ error: string | null }> {
  const { pricingFields } = submission;
  const approving = pricingFields.additional_labor_cents > 0;

  const { error } = await supabase.from("job_pricing").upsert(
    {
      job_id: jobId,
      ...pricingFields,
      additional_labor_approved_at: approving ? new Date().toISOString() : null,
      additional_labor_approved_by: approving ? adminId : null,
    },
    { onConflict: "job_id" },
  );

  return { error: error?.message ?? null };
}
