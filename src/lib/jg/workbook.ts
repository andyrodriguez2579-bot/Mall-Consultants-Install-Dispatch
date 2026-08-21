import * as XLSX from "xlsx";
import type { JgRateCardItem } from "./rate-card";

/**
 * The workbook JG Installations actually expects, filled in.
 *
 * Reproduces JG's own form shape -- every rate-card item present, in their
 * order, with a blank quantity and a $0.00 total for anything not performed
 * on this job -- rather than a short list of only what was entered. This is
 * their intake form; the safer choice is the one that looks like every other
 * submission they receive, not a shorter document someone on their side has
 * to interpret differently.
 *
 * The rate card is a parameter rather than an import of
 * `./rate-card` -- a pure function of its input is what lets this be tested
 * by running it directly with `node --test` (see the same choice, and why,
 * in install-templates.ts).
 */

export interface JgSubmissionSummary {
  accountName: string | null;
  accountNumber: string | null;
  rsmName: string | null;
  opco: string | null;
  startMileage: number;
  endMileage: number;
  commuterMiles: number;
  mileageCents: number;
  homeDepotCents: number;
  lowesCents: number;
  harborFreightCents: number;
  localHardwareCents: number;
  hotelCents: number;
  tollsParkingCents: number;
}

export interface JgSubmissionLine {
  rateCardItemId: string | null;
  category: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

const dollars = (cents: number): number => Math.round(cents) / 100;

export function buildJgWorkbookRows(
  summary: JgSubmissionSummary,
  lines: JgSubmissionLine[],
  subtotalCents: number,
  rateCard: JgRateCardItem[],
): (string | number)[][] {
  const rows: (string | number)[][] = [];

  rows.push(["Name of Contractor:", "Mall Consultants"]);
  rows.push(["Account Name: (MUST HAVE)", summary.accountName ?? ""]);
  rows.push(["Account #: (MUST HAVE)", summary.accountNumber ?? ""]);
  rows.push(["Job Sent by (RSM):", summary.rsmName ?? ""]);
  rows.push(["PFG or BEK or Nicholas or QSR or C-Store / OPCO:", summary.opco ?? ""]);
  rows.push([
    "Start Milage (add 0 if actual is not available)",
    summary.startMileage,
    "Total Job $",
    dollars(subtotalCents),
  ]);
  rows.push(["End Milage (add total for day if not tracking actual milage)", summary.endMileage]);
  rows.push([
    "Minus 30 mile commuter rule",
    summary.commuterMiles,
    "Milage $",
    dollars(summary.mileageCents),
  ]);
  rows.push([]);

  rows.push(["Service Type", "Description", "$ per Task", "# of Task", "Total"]);

  // The rate card by matched line, keyed by the slug the line was picked
  // from -- so every rate-card row prints, with the entered quantity where
  // one exists and blank/zero otherwise.
  const byItemId = new Map(lines.filter((l) => l.rateCardItemId).map((l) => [l.rateCardItemId, l]));

  let category = "";
  for (const item of rateCard) {
    if (item.category !== category) {
      if (category) rows.push([]);
      category = item.category;
    }
    const line = byItemId.get(item.id);
    rows.push([
      item.category,
      item.description,
      dollars(item.unitPriceCents),
      line ? line.quantity : "",
      dollars(line ? line.lineTotalCents : 0),
    ]);
  }

  // Anything entered that did not come from the rate card -- a one-off item
  // typed by hand -- still has to reach JG, so it is appended rather than
  // dropped.
  const extra = lines.filter((l) => !l.rateCardItemId);
  if (extra.length > 0) {
    rows.push([]);
    rows.push(["OTHER", "Not on the standard rate card", "", "", ""]);
    for (const line of extra) {
      rows.push([
        line.category,
        line.description,
        dollars(line.unitPriceCents),
        line.quantity,
        dollars(line.lineTotalCents),
      ]);
    }
  }

  rows.push([]);
  rows.push(["", "", "", "Total Job $", dollars(subtotalCents)]);
  rows.push([]);

  rows.push(["RETAIL", "TOTAL HOME DEPOT RECEIPT", "", "", dollars(summary.homeDepotCents)]);
  rows.push(["RETAIL", "TOTAL LOWES RECEIPT", "", "", dollars(summary.lowesCents)]);
  rows.push(["RETAIL", "TOTAL HARBOR FREIGHT RECEIPT", "", "", dollars(summary.harborFreightCents)]);
  rows.push(["RETAIL", "TOTAL LOCAL HARDWARE RECEIPT", "", "", dollars(summary.localHardwareCents)]);
  rows.push(["HOTEL STAY", "TOTAL HOTEL STAY", "", "", dollars(summary.hotelCents)]);
  rows.push(["TOLLS & PARKING", "TOTAL TOLLS & PARKINGS", "", "", dollars(summary.tollsParkingCents)]);

  return rows;
}

/** The same rows, as an .xlsx file's bytes -- what actually attaches to the email. */
export function buildJgWorkbookBuffer(
  summary: JgSubmissionSummary,
  lines: JgSubmissionLine[],
  subtotalCents: number,
  rateCard: JgRateCardItem[],
): Buffer {
  const rows = buildJgWorkbookRows(summary, lines, subtotalCents, rateCard);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 26 }, { wch: 55 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "JG Submission");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
