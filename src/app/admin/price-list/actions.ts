"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";
import { parseMoneyToCents } from "@/lib/format";

export interface PriceListState {
  error?: string;
  errors?: Record<string, string>;
  success?: string;
}

const priceSchema = z.string().transform((v, ctx) => {
  const cents = parseMoneyToCents(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 180 or 180.00." });
    return z.NEVER;
  }
  return cents;
});

const itemSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, "Use letters, digits and hyphens, e.g. SSDC-SWAP."),
  name: z.string().trim().min(2, "Give the work item a name."),
  description: z.string().trim().optional().transform((v) => v || null),
  customer_labor_price_cents: priceSchema,
  unit: z.string().trim().min(1).default("each"),
  scope_description: z.string().trim().optional().transform((v) => v || null),
  category: z.string().trim().optional().transform((v) => v || null),
});

function read(formData: FormData) {
  return itemSchema.safeParse({
    code: formData.get("code") ?? "",
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    customer_labor_price_cents: formData.get("customer_price") ?? "",
    scope_description: formData.get("scope_description") ?? "",
    unit: formData.get("unit") || "each",
    category: formData.get("category") ?? "",
  });
}

export async function createPriceListItem(
  _prev: PriceListState,
  formData: FormData,
): Promise<PriceListState> {
  await requireAdmin();

  const parsed = read(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("price_list_items").insert(parsed.data);

  if (error) {
    return {
      error: /duplicate|unique/i.test(error.message)
        ? `A work item with the code ${parsed.data.code} already exists.`
        : error.message,
    };
  }

  revalidatePath("/admin/price-list");
  return { success: `${parsed.data.name} added.` };
}

/**
 * Update a catalogue item.
 *
 * Existing jobs are unaffected: line items carry their own copy of the
 * description and rate, so re-pricing the catalogue never changes a figure a
 * contractor has already been offered or paid.
 */
export async function updatePriceListItem(
  _prev: PriceListState,
  formData: FormData,
): Promise<PriceListState> {
  await requireAdmin();

  const id = formData.get("id");
  if (typeof id !== "string") return { error: "Missing item." };

  const parsed = read(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("price_list_items").update(parsed.data).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/price-list");
  return { success: "Saved." };
}

/** Retire an item rather than deleting it, so historical jobs stay readable. */
export async function setPriceListItemActive(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = formData.get("id");
  const active = formData.get("is_active");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("price_list_items")
    .update({ is_active: active === "true" })
    .eq("id", id);

  revalidatePath("/admin/price-list");
}
