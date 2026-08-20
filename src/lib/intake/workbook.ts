import * as XLSX from "xlsx";

/**
 * Turning an install-request spreadsheet into the plain text the extractor
 * reads.
 *
 * The requests that arrive are survey workbooks with a dozen or more sheets,
 * most of which are product catalogue: only two or three carry the job. And the
 * ones that do are two-column forms -- a label cell, then its value in the next
 * cell across -- rather than prose. Flattening the grid naively produces
 * something the extractor cannot read and a person would not want to look at,
 * so this does two things: it drops the catalogue sheets, and it rewrites each
 * label/value pair onto its own line.
 */

export const SPREADSHEET_EXTENSIONS = [".xlsb", ".xlsx", ".xlsm", ".xls", ".csv"] as const;

/** Beyond this the remainder is catalogue, and the stored text stops being readable. */
const MAX_CHARS = 60_000;

/**
 * The job lives on the INSTALL sheet.
 *
 * The rest of the workbook is a product catalogue and a sales survey, and
 * pulling those in buries the contact, the scope and the equipment list in
 * several thousand lines of chemical SKUs. LEAD carries the same header block
 * as a fallback for workbooks laid out differently.
 */
const JOB_SHEETS = ["install", "lead"];

/** A form sheet has labels. A catalogue page mostly does not. */
const MIN_LABEL_CELLS = 3;

export function isSpreadsheetFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return value.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
  }
  return String(value).replace(/\s+/g, " ").trim();
};

const isLabelCell = (value: string): boolean => value.length <= 60 && value.endsWith(":");

/**
 * One row becomes one or more lines.
 *
 * A row of these forms holds several independent label/value pairs side by
 * side -- account number, then a machine spec, then a question. Emitting the
 * row as a single joined line would leave the extractor reading the next pair's
 * label as part of the previous pair's value, so each pair is given its own
 * line and anything unpaired is kept together as prose.
 */
function rowToLines(row: unknown[]): string[] {
  // Pairing works on the sparse row, not on the non-empty cells: a label takes
  // the value in the very next column or none at all. Closing the gaps first
  // would let a label in column 2 claim a part number from column 5, several
  // columns and one unrelated table away.
  const cells = row.map(cellText);
  const lines: string[] = [];
  let loose: string[] = [];

  const flush = () => {
    if (loose.length > 0) {
      lines.push(loose.join(" | "));
      loose = [];
    }
  };

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell === "") continue;

    const next = cells[i + 1] ?? "";
    if (isLabelCell(cell) && next !== "" && !isLabelCell(next)) {
      flush();
      lines.push(`${cell} ${next}`);
      i += 1;
    } else {
      loose.push(cell);
    }
  }

  flush();
  return lines;
}


// ---------------------------------------------------------------------------
// The sections that describe the job
// ---------------------------------------------------------------------------

/**
 * What the sheet is actually asking for, by section.
 *
 * The INSTALL sheet carries three lists that matter and one that does not. The
 * "Product # / Part Description / Quantity" table off to the right is the parts
 * set for a conveyor rental, marked "not supplied" -- it is reference material
 * printed on every copy of the form, identical whatever the job, and reading it
 * as this job's equipment produces two dozen bolts and curtain hooks nobody
 * ordered.
 *
 * The real request lives in columns 0-4, under headed sections: what is being
 * installed, what dispenser equipment goes with it, which chemicals are in use,
 * and a free-text note that is usually the clearest statement of the job.
 */
export type SheetSection = "install" | "dispenser_equipment" | "chemicals";

export interface SheetItem {
  section: SheetSection;
  /** The row's own label -- "Dispenser(s)", "Racks & Equipment", "FLOOR CLEANERS". */
  category: string;
  /** Leading item number, where the cell begins with one. */
  code: string | null;
  description: string;
  quantity: number | null;
}

export interface SheetDetails {
  items: SheetItem[];
  notes: string[];
  /**
   * The header block: who to write to about this install. Read from the grid
   * because the addresses sit beside their labels in adjacent cells, which
   * survives flattening only by accident.
   */
  contacts?: InstallContacts | null;
  /**
   * The customer's email, which the header block carries but the job record
   * has no column for. Kept here so it can reach the site instructions rather
   * than being lost between the sheet and the contractor.
   */
  customerEmail?: string | null;
}

const EMAIL_LABEL = /^customer\s+e-?mail\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;

const SECTION_HEADINGS: Array<{ match: RegExp; section: SheetSection | "notes" }> = [
  { match: /^products?\s+being\s+used/i, section: "chemicals" },
  { match: /^areas?\s+of\s+install/i, section: "install" },
  { match: /^dm\s+dispenser\s+equipment/i, section: "dispenser_equipment" },
  { match: /^notes\b/i, section: "notes" },
];

/** Column pairs: a label, then its value. The quantity column serves the second. */
const PAIRS: Array<{ label: number; value: number; quantity: number | null }> = [
  { label: 0, value: 1, quantity: null },
  { label: 2, value: 3, quantity: 4 },
];

/** "53000642 A-PROGRAM" -> code and description. */
const CODED_ITEM = /^(\d{5,10})\s+(.+)$/;

/**
 * Printed on every form, so it says nothing about this job.
 * A blank template's own placeholder text is not a note.
 */
const BOILERPLATE = [
  /^please see information enclosed/i,
  /^\*+completed by/i,
  /^quantity$/i,
];

const isHeadingCell = (text: string): boolean =>
  SECTION_HEADINGS.some((h) => h.match.test(text)) || /\*\*completed by/i.test(text);

export function readSheetDetails(rows: unknown[][]): SheetDetails {
  const items: SheetItem[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  let section: SheetSection | "notes" | null = null;
  let customerEmail: string | null = null;

  for (const row of rows) {
    const first = cellText(row[0]);

    if (customerEmail === null && EMAIL_LABEL.test(first)) {
      const found = EMAIL.exec(cellText(row[1]));
      if (found) customerEmail = found[0];
    }

    const heading = SECTION_HEADINGS.find((h) => h.match.test(first));
    if (heading) {
      section = heading.section;
      continue;
    }
    if (section === null) continue;

    if (section === "notes") {
      // The notes block runs until the next heading; a row with content in the
      // other columns is a different section starting, not a note.
      if (first === "" || isHeadingCell(first)) continue;
      if (BOILERPLATE.some((b) => b.test(first))) continue;
      notes.push(first);
      continue;
    }

    for (const pair of PAIRS) {
      const category = cellText(row[pair.label]);
      const raw = cellText(row[pair.value]);
      if (!category || !raw || isHeadingCell(category)) continue;

      const coded = CODED_ITEM.exec(raw);
      const code = coded ? coded[1]! : null;
      const description = coded ? coded[2]!.trim() : raw;

      const quantityCell = pair.quantity === null ? "" : cellText(row[pair.quantity]);
      const quantity = /^\d{1,4}$/.test(quantityCell) ? Number(quantityCell) : null;

      const key = `${section}|${category}|${code ?? ""}|${description}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({ section, category, code, description, quantity });
    }
  }

  return { items, notes, customerEmail };
}

function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
}

function looksLikeForm(rows: unknown[][]): boolean {
  let labels = 0;
  for (const row of rows) {
    for (const cell of row) {
      if (isLabelCell(cellText(cell))) {
        labels += 1;
        if (labels >= MIN_LABEL_CELLS) return true;
      }
    }
  }
  return false;
}

/** The job sheets, best first. Empty when the workbook has neither. */
function jobSheets(names: string[]): string[] {
  const matches: Array<{ name: string; rank: number }> = [];
  for (const name of names) {
    const lower = name.toLowerCase().trim();
    const rank = JOB_SHEETS.findIndex((p) => lower === p || lower.includes(p));
    if (rank !== -1) matches.push({ name, rank });
  }
  return matches.sort((a, b) => a.rank - b.rank).map((m) => m.name);
}

export interface WorkbookReadResult {
  text: string;
  /** Sheets that contributed, in the order they appear in the text. */
  sheetsUsed: string[];
  /** Sheets judged to be catalogue and left out. */
  sheetsSkipped: string[];
  /** What the sheet asks for, read from the grid rather than the flattened text. */
  details: SheetDetails;
  /** Everyone named at the top of the INSTALL sheet, for the readiness email. */
  contacts: InstallContacts | null;
  truncated: boolean;
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): WorkbookReadResult {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const wanted = jobSheets(workbook.SheetNames);
  const used: string[] = [];
  const skipped = workbook.SheetNames.filter((n) => !wanted.includes(n));
  const blocks: string[] = [];
  const items: SheetItem[] = [];
  const notes: string[] = [];
  let customerEmail: string | null = null;
  let contacts: InstallContacts | null = null;
  let length = 0;
  let truncated = false;

  for (const name of wanted) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const rows = sheetRows(sheet);
    const detail = readSheetDetails(rows);
    items.push(...detail.items);
    notes.push(...detail.notes);
    customerEmail = customerEmail ?? detail.customerEmail ?? null;

    // The first sheet carrying a customer address is the header block; later
    // sheets repeat labels in their product tables and would overwrite it.
    if (!contacts) {
      const found = readInstallContacts(rows);
      if (found.customerEmail || found.salesRepEmail || found.accountName) {
        contacts = found;
      }
    }
    const lines = rows.flatMap(rowToLines).filter((line) => line !== "");
    if (lines.length === 0) {
      skipped.push(name);
      continue;
    }

    // No colon in the divider: the extractor reads "Word:" as a label, and a
    // sheet name must not be mistaken for one.
    const block = [`--- ${name} ---`, ...lines].join("\n");
    if (length + block.length > MAX_CHARS) {
      truncated = true;
      break;
    }

    blocks.push(block);
    length += block.length + 2;
    used.push(name);
  }

  // A workbook with no INSTALL or LEAD sheet is not necessarily the wrong file
  // -- it may simply be laid out differently. Fall back to the first
  // form-shaped sheet and let a person judge it, rather than returning nothing.
  if (blocks.length === 0) {
    const fallback = workbook.SheetNames.find((name) => {
      const sheet = workbook.Sheets[name];
      return sheet ? looksLikeForm(sheetRows(sheet)) : false;
    });
    const sheet = fallback ? workbook.Sheets[fallback] : undefined;
    if (fallback && sheet) {
      const lines = sheetRows(sheet).flatMap(rowToLines).filter(Boolean);
      blocks.push([`--- ${fallback} ---`, ...lines].join("\n").slice(0, MAX_CHARS));
      used.push(fallback);
      const at = skipped.indexOf(fallback);
      if (at !== -1) skipped.splice(at, 1);
    }
  }

  return {
    text: blocks.join("\n\n"),
    sheetsUsed: used,
    sheetsSkipped: skipped,
    details: { items, notes, customerEmail, contacts },
    contacts,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// The contact block at the top of an INSTALL sheet.
//
// Everyone who needs to hear about the job is named there: the customer, the
// PFS sales rep, the SSDC rep who signed the work order, and the PFG
// specialist. The site-readiness email goes to those addresses, so reading
// them off the sheet is what removes the last retyping from the intake.
//
// It lives in this file rather than beside it because workbook.ts is imported
// directly by the tests, and a relative import of a sibling module is not
// resolvable there without a compiler flag this project does not set.
// ---------------------------------------------------------------------------

export interface InstallContacts {
  accountName: string | null;
  accountNumber: string | null;
  streetAddress: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;

  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;

  salesRepName: string | null;
  salesRepPhone: string | null;
  salesRepEmail: string | null;

  /** The RSM. The sheet carries the name but never an address. */
  ssdcRepName: string | null;

  specialistName: string | null;
  specialistEmail: string | null;

  operatingCompany: string | null;
  /** Present only when a machine was ordered, which is the dish-machine tell. */
  machineModels: string[];
}

// EMAIL is declared once, above, with the customer-email label it also serves.
const cell = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

/** Compare labels ignoring case, punctuation and the notes in parentheses. */
const normalize = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * "Brooklyn NY, 11217" and "Ringwood, NJ 07456" are both in use, and one form
 * puts the comma where the other does not. Read the ZIP and the state from the
 * end, where they are unambiguous, and treat whatever is left as the city.
 */
export function splitCityStateZip(value: string | null): {
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
} {
  if (!value) return { city: null, stateCode: null, postalCode: null };

  const zip = value.match(/(\d{5}(?:-\d{4})?)\s*$/);
  const withoutZip = zip ? value.slice(0, zip.index).trim() : value.trim();
  const trimmed = withoutZip.replace(/[,\s]+$/, "");

  const state = trimmed.match(/[,\s]([A-Za-z]{2})$/);
  const city =
    state && state.index !== undefined
      ? trimmed.slice(0, state.index).replace(/[,\s]+$/, "")
      : trimmed;

  return {
    city: city || null,
    stateCode: state?.[1] ? state[1].toUpperCase() : null,
    postalCode: zip?.[1] ?? null,
  };
}

/**
 * Read the header block.
 *
 * Only the first column is treated as a label. The INSTALL sheet has a second
 * block of SSDC-only fields further right on the same rows, and reading labels
 * from anywhere would let "BREAKER:" or "VOLTAGE:" answer for the customer.
 */
export function readInstallContacts(rows: unknown[][]): InstallContacts {
  const values = new Map<string, string>();
  const machineModels: string[] = [];

  for (const row of rows.slice(0, 40)) {
    const label = normalize(cell(row[0]));
    if (!label) continue;

    const value = cell(row[1]);

    if (/^machine model ordered/.test(label)) {
      if (value) machineModels.push(value);
      continue;
    }

    // First one wins: the block is at the top, and the same words recur further
    // down the sheet in the product tables.
    if (value && !values.has(label)) values.set(label, value);
  }

  const get = (...labels: string[]): string | null => {
    for (const label of labels) {
      const hit = values.get(label);
      if (hit) return hit;
    }
    return null;
  };

  /** An address field that must actually be one; the sheet leaves blanks. */
  const email = (...labels: string[]): string | null => {
    const raw = get(...labels);
    const found = raw?.match(EMAIL);
    return found ? found[0] : null;
  };

  const place = splitCityStateZip(get("city state zip"));

  return {
    accountName: get("account name"),
    accountNumber: get("pfs acct number", "pfs account number", "b9 account number"),
    streetAddress: get("street address"),
    ...place,

    customerName: get("customer first last name", "customer name"),
    customerPhone: get("customer phone"),
    customerEmail: email("customer email"),

    salesRepName: get("pfs sales rep"),
    salesRepPhone: get("pfs sales rep phone"),
    salesRepEmail: email("pfs sales rep email"),

    ssdcRepName: get("ssdc rep serves as signed pwo", "ssdc rep"),

    // "Irwin Yaffe - 609-744-6016" carries a phone; the name is what is wanted.
    specialistName: get("pfg specialist")?.split(/\s+-\s+/)[0]?.trim() || null,
    specialistEmail: email("pfg specialist email tel", "pfg specialist email"),

    operatingCompany: get("pfs opco"),
    machineModels,
  };
}

/**
 * Everyone the site-readiness email should reach, deduplicated.
 *
 * The SSDC rep is named on the sheet but never given an address, so their email
 * is looked up from the roster rather than found here -- which is why the
 * caller passes it in.
 */
export function readinessRecipients(
  contacts: InstallContacts,
  rsmEmail: string | null,
): string[] {
  const all = [contacts.customerEmail, contacts.salesRepEmail, rsmEmail];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of all) {
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

