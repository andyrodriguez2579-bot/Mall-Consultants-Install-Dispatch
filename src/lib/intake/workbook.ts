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
    details: { items, notes, customerEmail },
    truncated,
  };
}
