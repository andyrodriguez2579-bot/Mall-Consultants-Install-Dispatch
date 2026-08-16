import type { ParsedRequest } from "./parse";
import type { EquipmentItem } from "./workbook";

/**
 * A job title and scope written from what was extracted, rather than lifted
 * out of the sheet.
 *
 * A survey workbook is a form, not a description of work. Its first prose-like
 * line is something like "B9 ACCOUNT NUMBER (REQ.) | 509103264 | HT Dish
 * Machine", and taking the whole flattened sheet as the scope sends a
 * contractor several hundred lines of sales fields to read around. Both are
 * composed here from the fields that were actually identified, and both remain
 * editable on the review screen -- the sheet is still kept verbatim as the
 * record of what was asked for.
 */

const value = (f: { value: string } | null | undefined): string | null => f?.value ?? null;

export function sheetTitle(parsed: ParsedRequest): string {
  const who = value(parsed.site_name) ?? value(parsed.customer_name);
  const where = value(parsed.city);

  if (who && where) return `SSDC installation — ${who}, ${where}`;
  if (who) return `SSDC installation — ${who}`;
  return "SSDC installation";
}

/**
 * The scope a contractor reads before accepting.
 *
 * Deliberately short. The parts list goes to the site instructions, and the
 * exact address and contact are released on acceptance, so this says what the
 * work is and roughly where -- enough to judge whether to take it.
 */
export function sheetScope(parsed: ParsedRequest, equipment: EquipmentItem[]): string {
  const who = value(parsed.site_name) ?? value(parsed.customer_name);
  const city = value(parsed.city);
  const state = value(parsed.state_code);

  const place = [city, state].filter(Boolean).join(", ");
  const lines: string[] = [
    who
      ? `SSDC installation at ${who}${place ? ` in ${place}` : ""}.`
      : `SSDC installation${place ? ` in ${place}` : ""}.`,
  ];

  const machines = [...new Set(equipment.map((e) => e.group).filter((g): g is string => Boolean(g)))];
  if (machines.length > 0) {
    lines.push("", `Machines: ${machines.join("; ")}.`);
  }

  if (equipment.length > 0) {
    const total = equipment.reduce((sum, e) => sum + (e.quantity ?? 1), 0);
    lines.push(
      `${equipment.length} part${equipment.length === 1 ? "" : "s"} to install (${total} item${
        total === 1 ? "" : "s"
      } in total). Full list in the site instructions.`,
    );
  }

  return lines.join("\n");
}
