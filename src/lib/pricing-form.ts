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

export interface PricingLineSubmission {
  service_item_id: string | null;
  description: string;
  unit_price_cents: number;
  quantity: number;
  sort_order: number;
}

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
  /** Goes on `job_service_lines` -- administrators only. */
  lines: PricingLineSubmission[];
  /** Goes on `job_pricing` -- administrators only. */
  pricingFields: {
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

/**
 * The service lines, read from the repeated fields the panel emits.
 *
 * FormData preserves document order, so the parallel lists line up by index --
 * one entry per line for each of the four fields. Lines with no description and
 * no price are dropped: the panel always shows at least one row, and an
 * untouched row is not a service.
 */
function readLines(formData: FormData): PricingLineSubmission[] {
  const ids = formData.getAll("line_service_item_id");
  const descriptions = formData.getAll("line_description");
  const prices = formData.getAll("line_unit_price");
  const quantities = formData.getAll("line_quantity");

  const lines: PricingLineSubmission[] = [];

  for (let i = 0; i < descriptions.length; i += 1) {
    const description = String(descriptions[i] ?? "").trim();
    const unit = parseMoneyToCents(String(prices[i] ?? "")) ?? 0;
    const quantityRaw = Number(String(quantities[i] ?? "1"));
    const quantity = Number.isFinite(quantityRaw) && quantityRaw >= 0 ? quantityRaw : 0;

    if (!description && unit === 0) continue;

    const id = String(ids[i] ?? "").trim();
    lines.push({
      service_item_id: id || null,
      description,
      unit_price_cents: unit,
      quantity,
      sort_order: lines.length,
    });
  }

  return lines;
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
  const lines = readLines(formData);
  const rawShare = formData.get("contractor_percentage");
  const shareSupplied = typeof rawShare === "string" && rawShare.trim() !== "";
  const bps = percentageBps(formData, "contractor_percentage");

  return {
    invalidPercentage: shareSupplied && bps === undefined,
    lines,
    jobFields: {
      // The job keeps the first line for display and for matching contractors
      // by service; the priced detail lives on the lines themselves.
      service_item_id: lines[0]?.service_item_id ?? null,
      service_type: lines[0]?.description ?? null,
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
      additional_labor_cents: additional,
      additional_labor_reason: additional > 0 ? text(formData, "additional_labor_reason") : null,
      ...(bps === undefined ? {} : { contractor_percentage_bps: bps }),
    },
  };
}

/** Validation the database also enforces, phrased for a person. */
export function validatePricing(submission: PricingSubmission): Record<string, string> | null {
  const errors: Record<string, string> = {};
  const { additional_labor_cents, additional_labor_reason } = submission.pricingFields;

  if (submission.invalidPercentage) {
    errors.contractor_percentage = "The contractor share must be a percentage between 0 and 100.";
  }
  if (submission.lines.length === 0) {
    errors.lines = "Add at least one service with a customer price.";
  }
  submission.lines.forEach((line, index) => {
    if (!line.description) {
      errors.lines = `Service ${index + 1} needs a description.`;
    } else if (line.unit_price_cents <= 0) {
      errors.lines = `Service ${index + 1} needs a customer price.`;
    } else if (line.quantity <= 0) {
      errors.lines = `Service ${index + 1} needs a quantity above zero.`;
    }
  });
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
  const { pricingFields, lines } = submission;
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

  if (error) return { error: error.message };

  // Replaced wholesale rather than diffed. Lines carry no identity a person
  // relies on, and a partial update that half-applied would leave a job priced
  // at something nobody chose.
  const { error: clearError } = await supabase
    .from("job_service_lines")
    .delete()
    .eq("job_id", jobId);

  if (clearError) return { error: clearError.message };

  if (lines.length === 0) return { error: null };

  const { error: linesError } = await supabase
    .from("job_service_lines")
    .insert(lines.map((line) => ({ job_id: jobId, ...line })));

  return { error: linesError?.message ?? null };
}
