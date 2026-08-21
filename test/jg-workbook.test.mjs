import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { buildJgWorkbookBuffer, buildJgWorkbookRows } from "../src/lib/jg/workbook.ts";

/**
 * The workbook actually submitted to JG Installations for payment.
 *
 * These numbers are what Mall Consultants gets paid, so the two things worth
 * proving are: every rate-card item still appears even when it was not used
 * (JG's own form has no gaps), and a job's real quantities land on the right
 * row rather than the row above or below it.
 */

const rateCard = [
  { id: "stop--a", category: "STOP CHARGE", description: "Truck stop A", unitPriceCents: 6790 },
  { id: "stop--b", category: "STOP CHARGE", description: "Truck stop B", unitPriceCents: 8050 },
  { id: "install--a", category: "INSTALL EQUIPMENT", description: "A-Program", unitPriceCents: 12040 },
  { id: "install--b", category: "INSTALL EQUIPMENT", description: "Moprite III", unitPriceCents: 8050 },
];

const summary = {
  accountName: "Stoney Brook Grill",
  accountNumber: "40219",
  rsmName: "Chris Medeiros",
  opco: "PFG",
  startMileage: 0,
  endMileage: 155,
  commuterMiles: 125,
  mileageCents: 8750,
  homeDepotCents: 0,
  lowesCents: 0,
  harborFreightCents: 0,
  localHardwareCents: 0,
  hotelCents: 0,
  tollsParkingCents: 0,
};

test("every rate-card item appears even when nothing was entered for it", () => {
  const rows = buildJgWorkbookRows(summary, [], 0, rateCard);
  const descriptions = rows.map((r) => r[1]);
  for (const item of rateCard) {
    assert.ok(descriptions.includes(item.description), `${item.description} is missing from the sheet`);
  }
});

test("a matched line's quantity lands on its own row, not another one", () => {
  const lines = [
    {
      rateCardItemId: "install--a",
      category: "INSTALL EQUIPMENT",
      description: "A-Program",
      unitPriceCents: 12040,
      quantity: 2,
      lineTotalCents: 24080,
    },
  ];
  const rows = buildJgWorkbookRows(summary, lines, 24080, rateCard);

  const aProgram = rows.find((r) => r[1] === "A-Program");
  assert.deepEqual([aProgram[2], aProgram[3], aProgram[4]], [120.4, 2, 240.8]);

  // Everything else stays blank/zero -- the row above it in particular, since
  // that is what a copy-paste-down-one-row bug would corrupt.
  const moprite = rows.find((r) => r[1] === "Moprite III");
  assert.deepEqual([moprite[3], moprite[4]], ["", 0]);
});

test("the subtotal is shown at both the header and the total line", () => {
  const rows = buildJgWorkbookRows(summary, [], 24080, rateCard);
  const headerTotal = rows.find((r) => r[2] === "Total Job $");
  const footerTotal = rows.find((r) => r[3] === "Total Job $");
  assert.equal(headerTotal[3], 240.8);
  assert.equal(footerTotal[4], 240.8);
});

test("a one-off item not on the rate card is still reported, not dropped", () => {
  const lines = [
    {
      rateCardItemId: null,
      category: "OTHER",
      description: "Emergency parts run",
      unitPriceCents: 5000,
      quantity: 1,
      lineTotalCents: 5000,
    },
  ];
  const rows = buildJgWorkbookRows(summary, lines, 5000, rateCard);
  assert.ok(rows.some((r) => r[1] === "Emergency parts run"));
});

test("mileage and the four retail buckets print as their own figures", () => {
  const withReceipts = {
    ...summary,
    homeDepotCents: 4599,
    lowesCents: 0,
    harborFreightCents: 1200,
    localHardwareCents: 0,
    hotelCents: 8900,
    tollsParkingCents: 1550,
  };
  const rows = buildJgWorkbookRows(withReceipts, [], 0, rateCard);

  const milageRow = rows.find((r) => r[2] === "Milage $");
  assert.equal(milageRow[3], 87.5);

  assert.ok(rows.some((r) => r[1] === "TOTAL HOME DEPOT RECEIPT" && r[4] === 45.99));
  assert.ok(rows.some((r) => r[1] === "TOTAL HARBOR FREIGHT RECEIPT" && r[4] === 12));
  assert.ok(rows.some((r) => r[1] === "TOTAL HOTEL STAY" && r[4] === 89));
  assert.ok(rows.some((r) => r[1] === "TOTAL TOLLS & PARKINGS" && r[4] === 15.5));
});

test("the generated file is a real, readable workbook", () => {
  const buffer = buildJgWorkbookBuffer(summary, [], 0, rateCard);
  assert.ok(buffer.length > 0);

  const wb = XLSX.read(buffer, { type: "buffer" });
  assert.ok(wb.SheetNames.includes("JG Submission"));

  const rows = XLSX.utils.sheet_to_json(wb.Sheets["JG Submission"], { header: 1 });
  assert.equal(rows[1][1], "Stoney Brook Grill");
});
