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
// Equipment
// ---------------------------------------------------------------------------

export interface EquipmentItem {
  /** The machine or assembly the parts belong to, when the sheet groups them. */
  group: string | null;
  partNumber: string;
  description: string;
  quantity: number | null;
}

const PART_NUMBER = /^\d{5,10}$/;
/** Sheets carry the count in the description -- "Short Curtain (2)". */
const TRAILING_COUNT = /\s*\((\d{1,3})\)\s*$/;

const headerIndex = (row: unknown[], match: RegExp): number =>
  row.findIndex((cell) => match.test(cellText(cell)));

/**
 * The parts table, read by column rather than from the flattened text.
 *
 * The sheet repeats its "Product # / Part Description / Quantity" header once
 * per machine option, with the machine named on its own row above the parts, so
 * the table is walked header by header rather than assumed to appear once.
 */
export function readEquipment(rows: unknown[][]): EquipmentItem[] {
  const items: EquipmentItem[] = [];
  const seen = new Set<string>();
  let partCol = -1;
  let descCol = -1;
  let qtyCol = -1;
  let group: string | null = null;

  for (const row of rows) {
    const maybePart = headerIndex(row, /^product\s*#?$/i);
    if (maybePart !== -1) {
      partCol = maybePart;
      descCol = headerIndex(row, /^part\s+description$/i);
      qtyCol = headerIndex(row, /^quantity$/i);
      group = null;
      continue;
    }

    if (partCol === -1 || descCol === -1) continue;

    const part = cellText(row[partCol]);
    const desc = cellText(row[descCol]);

    // A name in the part column with nothing beside it heads the next block.
    if (part !== "" && desc === "" && !PART_NUMBER.test(part)) {
      group = part;
      continue;
    }

    if (!PART_NUMBER.test(part) || desc === "") continue;

    const explicit = qtyCol === -1 ? "" : cellText(row[qtyCol]);
    const trailing = TRAILING_COUNT.exec(desc);
    const quantity = explicit !== "" && /^\d+$/.test(explicit)
      ? Number(explicit)
      : trailing
        ? Number(trailing[1])
        : null;

    const description = desc.replace(TRAILING_COUNT, "").trim();
    const key = `${group ?? ""}|${part}|${description}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({ group, partNumber: part, description, quantity });
  }

  return items;
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
  /** The parts table, read from the grid rather than the flattened text. */
  equipment: EquipmentItem[];
  truncated: boolean;
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): WorkbookReadResult {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const wanted = jobSheets(workbook.SheetNames);
  const used: string[] = [];
  const skipped = workbook.SheetNames.filter((n) => !wanted.includes(n));
  const blocks: string[] = [];
  const equipment: EquipmentItem[] = [];
  let length = 0;
  let truncated = false;

  for (const name of wanted) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const rows = sheetRows(sheet);
    equipment.push(...readEquipment(rows));
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
    equipment,
    truncated,
  };
}
