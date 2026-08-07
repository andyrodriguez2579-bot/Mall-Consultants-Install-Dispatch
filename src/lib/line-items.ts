import { z } from "zod";
import { readMulti } from "./validation";

/**
 * Reading the line-item editor's submission.
 *
 * The editor posts parallel arrays -- one entry per row across several field
 * names -- because that is what a plain HTML form can express without
 * JavaScript-serialised JSON. Shared between job creation and request
 * conversion so both paths price a job identically.
 */

const lineItemSchema = z.object({
  code: z.string().trim().optional(),
  description: z.string().trim().min(1),
  unit: z.string().trim().default("each"),
  unit_price_cents: z.coerce.number().int().min(0),
  quantity: z.coerce.number().positive().max(9999),
  price_list_item_id: z.string().uuid().optional().or(z.literal("")),
});

export interface ParsedLineItem {
  code: string | null;
  description: string;
  unit: string;
  unit_price_cents: number;
  quantity: number;
  price_list_item_id: string | null;
  sort_order: number;
}

export function readLineItems(formData: FormData): ParsedLineItem[] {
  const descriptions = readMulti(formData, "li_description");
  const codes = readMulti(formData, "li_code");
  const units = readMulti(formData, "li_unit");
  const prices = readMulti(formData, "li_unit_price_cents");
  const quantities = readMulti(formData, "li_quantity");
  const itemIds = readMulti(formData, "li_price_list_item_id");

  const rows: ParsedLineItem[] = [];

  for (let i = 0; i < descriptions.length; i += 1) {
    // A row zeroed out in the editor counts as removed.
    const quantity = Number(quantities[i] ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const parsed = lineItemSchema.safeParse({
      code: codes[i] ?? "",
      description: descriptions[i],
      unit: units[i] || "each",
      unit_price_cents: prices[i] ?? 0,
      quantity,
      price_list_item_id: itemIds[i] ?? "",
    });

    if (!parsed.success) continue;

    rows.push({
      code: parsed.data.code || null,
      description: parsed.data.description,
      unit: parsed.data.unit,
      unit_price_cents: parsed.data.unit_price_cents,
      quantity: parsed.data.quantity,
      price_list_item_id: parsed.data.price_list_item_id || null,
      sort_order: (i + 1) * 10,
    });
  }

  return rows;
}

export const lineItemsTotal = (rows: ParsedLineItem[]): number =>
  rows.reduce((sum, li) => sum + Math.round(li.unit_price_cents * li.quantity), 0);

/**
 * Work order fields that are withheld from a contractor until the job is
 * theirs. Read separately from the main job schema because they are optional
 * and free-text throughout.
 */
export function readWorkOrderFields(formData: FormData) {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  return {
    site_contact_name: text("site_contact_name"),
    site_contact_phone: text("site_contact_phone"),
    access_notes: text("access_notes"),
    customer_reference: text("customer_reference"),
  };
}
