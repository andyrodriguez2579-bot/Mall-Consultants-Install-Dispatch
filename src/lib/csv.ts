/**
 * Minimal RFC 4180 CSV writer.
 *
 * Job scopes contain commas, quotes and newlines routinely, so escaping is not
 * optional here. The leading-character guard below prevents a spreadsheet from
 * interpreting a field as a formula when the file is opened -- job titles and
 * customer names come from user input.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);
  if (FORMULA_TRIGGERS.test(text)) text = `'${text}`;
  if (NEEDS_QUOTING.test(text)) text = `"${text.replaceAll('"', '""')}"`;

  return text;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<unknown>>,
): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // CRLF is what Excel expects; a BOM keeps it from mangling non-ASCII names.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Money is stored in cents; exports carry decimal dollars for accounting. */
export const centsToDecimal = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);

export const isoOrBlank = (value: string | null | undefined): string => value ?? "";
