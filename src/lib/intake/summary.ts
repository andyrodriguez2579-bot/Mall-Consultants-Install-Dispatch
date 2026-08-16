import type { ParsedRequest } from "./parse";
import type { SheetDetails, SheetItem, SheetSection } from "./workbook";

/**
 * A job title, scope and set of site instructions written from what the sheet
 * asked for, rather than lifted out of the grid.
 *
 * A survey workbook is a form, not a description of work. Its first prose-like
 * line is something like "B9 ACCOUNT NUMBER (REQ.) | 509103264 | HT Dish
 * Machine", and taking the whole flattened sheet as the scope sends a
 * contractor several hundred lines of sales fields to read around. What is
 * written here is composed from the identified fields and the sheet's own
 * sections, and all of it stays editable on the review screen -- the sheet
 * itself is still kept verbatim as the record of what was asked for.
 */

const value = (f: { value: string } | null | undefined): string | null => f?.value ?? null;

const SECTION_TITLE: Record<SheetSection, string> = {
  install: "To install",
  dispenser_equipment: "Dispenser equipment",
  chemicals: "Chemicals in use",
};

const SECTION_ORDER: SheetSection[] = ["install", "dispenser_equipment", "chemicals"];

/**
 * Plain hyphens, not em dashes: the title goes into the offer SMS, and a single
 * character outside GSM-7 re-encodes the whole message as UCS-2 -- 70
 * characters per segment instead of 160.
 */
export function sheetTitle(parsed: ParsedRequest): string {
  const who = value(parsed.site_name) ?? value(parsed.customer_name);
  const where = value(parsed.city);

  if (who && where) return `SSDC installation - ${who}, ${where}`;
  if (who) return `SSDC installation - ${who}`;
  return "SSDC installation";
}

/**
 * The scope a contractor reads before accepting.
 *
 * The sheet's own notes lead, because they are the clearest statement of the
 * job on the form -- "PLEASE INSTALL SINKRITE AND GANG A SOLO FLOOR DISPENSER
 * AT THE 3 COMP SINK" says more than any field. The full item list goes to the
 * site instructions; this stays short enough to read on a phone.
 */
export function sheetScope(parsed: ParsedRequest, details: SheetDetails): string {
  const who = value(parsed.site_name) ?? value(parsed.customer_name);
  const place = [value(parsed.city), value(parsed.state_code)].filter(Boolean).join(", ");

  const lines: string[] = [
    who
      ? `SSDC installation at ${who}${place ? ` in ${place}` : ""}.`
      : `SSDC installation${place ? ` in ${place}` : ""}.`,
  ];

  if (details.notes.length > 0) {
    lines.push("", ...details.notes);
  }

  const installing = details.items
    .filter((i) => i.section === "install" || i.section === "dispenser_equipment")
    .map((i) => i.description);

  if (installing.length > 0) {
    lines.push("", `Installing: ${[...new Set(installing)].join("; ")}.`);
  }

  return lines.join("\n");
}

/**
 * The site instructions: everything the contractor needs on site, itemised.
 *
 * Item numbers are kept alongside the descriptions. A contractor collecting
 * stock is matching numbers, not names, and "STD SINK RITE SOLO" is not
 * something to go looking for by eye.
 */
export function sheetInstructions(
  details: SheetDetails,
  parsed: ParsedRequest,
  customerEmail?: string | null,
): string {
  const blocks: string[] = [];

  for (const section of SECTION_ORDER) {
    const items = details.items.filter((i) => i.section === section);
    if (items.length === 0) continue;

    blocks.push(
      [
        `${SECTION_TITLE[section]}:`,
        ...items.map((item) => `  ${describe(item)}`),
      ].join("\n"),
    );
  }

  const contact = value(parsed.site_contact_name);
  const phone = value(parsed.site_contact_phone);
  if (contact || phone || customerEmail) {
    blocks.push(
      [
        "Site contact:",
        contact ? `  ${contact}` : null,
        phone ? `  ${phone}` : null,
        customerEmail ? `  ${customerEmail}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return blocks.join("\n\n");
}

function describe(item: SheetItem): string {
  const quantity = item.quantity && item.quantity > 1 ? `${item.quantity} x ` : "";
  const code = item.code ? ` (item ${item.code})` : "";
  return `${quantity}${item.description}${code} - ${item.category}`;
}
