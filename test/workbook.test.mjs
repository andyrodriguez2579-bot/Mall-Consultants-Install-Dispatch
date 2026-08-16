import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { readSheetDetails, readWorkbook, isSpreadsheetFilename } from "../src/lib/intake/workbook.ts";
import { parseInstallRequest } from "../src/lib/intake/parse.ts";

/**
 * A stand-in for a real install sheet, laid out the way the real ones are: a
 * two-column form on the left, an unrelated second column block beside it, and
 * a parts table several columns further right with a machine name heading each
 * block. The gaps matter -- they are what a naive flattening gets wrong.
 */
function installSheet() {
  const rows = [
    ["Survey-Installation Form"],
    ["ACCOUNT NAME:", "Luigi's Pizza", "TO BE COMPLETED BY SSDC ONLY:", "", "", "", "", ""],
    ["STREET ADDRESS:", "16 Skyline Lake Drive", "ONE INST DM:", "JAMES STOKEM"],
    ["CITY, STATE, ZIP:", "Ringwood NJ 07456", "CONNECTION:", "", "", "Product #", "Part Description", "Quantity"],
    ["CUSTOMER FIRST & LAST NAME:", "Anthony Martinelli", "VOLTAGE:", "", "", "Standard Height Conveyor"],
    ["CUSTOMER PHONE:", "973-800-2686", "BREAKER:", "", "", "96522180", "Standard Hood Vent Cowl (2)"],
    ["CUSTOMER EMAIL:", "a@example.com", "", "", "", "53001265", "Short Curtain (4)"],
    // The conveyor table continues down the right-hand columns throughout.
    ["PRODUCTS BEING USED", "", "", "", "", "96522211", "High Hood Vent Cowl (2)"],
    ["3 SINK - DETERGENTS", "243641 DM TRIO PREM DISH DET 2/1 GAL SNAP PACK", "3 SINK - DETERGENTS", "", "", "88020433", "Bolt SS (13)"],
    ["FLOOR CLEANERS", "244422 FM ALL PURP & FLR CLNR 4/1 GAL", "GLASS CLEANERS", "", "", "88429113", "Lock-Nut SS (13)"],
    ["AREAS OF INSTALL: **COMPLETED BY SSDC**", "", "", "", "QUANTITY"],
    ["DM Set-up (1)", "", "Spray Bottles"],
    ["Dispenser(s)", "53000642 A-PROGRAM", "Racks & Equipment", "92153964 HI FLW AIR GAP WHT PP", "1"],
    ["Dispenser(s)", "92211944 STD SINK RITE SOLO", "Racks & Equipment", "92220912 TBG FLX GRAY", "2"],
    ["DM DISPENSER EQUIPMENT **COMPLETED BY SSDC**"],
    ["EQUIPMENT", "", "EQUIPMENT"],
    ["NOTES"],
    ["PLEASE INSTALL SINKRITE AND GANG A SOLO FLOOR DISPENSER AT THE 3 COMP SINK"],
    ["Please see information enclosed in the tabs below regarding recommended tips and caps."],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "INSTALL");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["FM Trio Premium Dish Detergent"], ["Item #243641"]]),
    "SURVEY",
  );
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

test("only the install sheet is read", () => {
  const result = readWorkbook(installSheet());
  assert.deepEqual(result.sheetsUsed, ["INSTALL"]);
  assert.ok(result.sheetsSkipped.includes("SURVEY"), "the catalogue sheet is left out");
  assert.ok(!result.text.includes("Dish Detergent"), "catalogue content must not leak in");
});

test("a label takes the value beside it, never one several columns away", () => {
  const { text } = readWorkbook(installSheet());

  assert.ok(text.includes("ACCOUNT NAME: Luigi's Pizza"));
  assert.ok(text.includes("CUSTOMER PHONE: 973-800-2686"));

  // "BREAKER:" sits in column 2 with column 3 empty; the next non-empty cell on
  // its row is a part number in column 5. It must not be paired with it.
  assert.ok(!/BREAKER:\s*96522180/.test(text), "a label must not reach across empty columns");
});

test("the conveyor reference table is not read as this job's equipment", () => {
  const { details } = readWorkbook(installSheet());

  // That table is printed on every copy of the form, marked "not supplied".
  // Reading it produces two dozen bolts and curtain hooks nobody ordered.
  const descriptions = details.items.map((i) => i.description).join(" | ");
  assert.ok(!/Hood Vent Cowl|Lock-Nut|Bolt SS|Short Curtain/.test(descriptions),
    `conveyor reference parts leaked in: ${descriptions}`);
});

test("the sheet's own sections are read, with codes and quantities", () => {
  const { details } = readWorkbook(installSheet());

  const install = details.items.filter((i) => i.section === "install");
  assert.equal(install.length, 4);

  assert.deepEqual(install[0], {
    section: "install",
    category: "Dispenser(s)",
    code: "53000642",
    description: "A-PROGRAM",
    quantity: null,
  });

  // The quantity column serves the right-hand pair only.
  const tubing = install.find((i) => i.description.startsWith("TBG FLX"));
  assert.equal(tubing.quantity, 2);

  const chemicals = details.items.filter((i) => i.section === "chemicals");
  assert.equal(chemicals.length, 2);
  assert.equal(chemicals[0].code, "243641");
  assert.equal(chemicals[0].category, "3 SINK - DETERGENTS");

  // An empty row under a heading contributes nothing.
  assert.ok(!details.items.some((i) => i.description === ""));
});

test("the sheet's notes are kept and its printed boilerplate is not", () => {
  const { details } = readWorkbook(installSheet());

  assert.deepEqual(details.notes, [
    "PLEASE INSTALL SINKRITE AND GANG A SOLO FLOOR DISPENSER AT THE 3 COMP SINK",
  ]);
});

test("the flattened sheet feeds the extractor the job's own address", () => {
  const { text } = readWorkbook(installSheet());
  const parsed = parseInstallRequest(text, []);

  assert.equal(parsed.customer_name?.value, "Luigi's Pizza");
  assert.equal(parsed.address_line1?.value, "16 Skyline Lake Drive");
  assert.equal(parsed.city?.value, "Ringwood");
  assert.equal(parsed.state_code?.value, "NJ");
  assert.equal(parsed.postal_code?.value, "07456");
  assert.equal(parsed.site_contact_name?.value, "Anthony Martinelli");
  assert.equal(parsed.site_contact_phone?.value, "+19738002686");

  // Every field above was labelled on the sheet, so none of them are guesses.
  for (const key of ["customer_name", "address_line1", "city", "site_contact_phone"]) {
    assert.equal(parsed[key].basis, "label", `${key} should be read, not inferred`);
  }
});

test("the sheet divider is not mistaken for a job title", () => {
  const parsed = parseInstallRequest(readWorkbook(installSheet()).text, []);
  assert.ok(
    !parsed.title || !/^-{2,}/.test(parsed.title.value),
    `divider leaked into the title: ${parsed.title?.value}`,
  );
});

test("a workbook with no install sheet falls back rather than returning nothing", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["CUSTOMER:", "Acme"],
      ["ADDRESS:", "1 Main St"],
      ["PHONE:", "713-555-0199"],
    ]),
    "Form1",
  );
  const result = readWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));

  assert.deepEqual(result.sheetsUsed, ["Form1"]);
  assert.ok(result.text.includes("CUSTOMER: Acme"));
});

test("filenames are checked before the bytes are", () => {
  assert.ok(isSpreadsheetFilename("LUIGI'S PIZZA INSTALL REQUEST.xlsb"));
  assert.ok(isSpreadsheetFilename("form.XLSX"));
  assert.ok(!isSpreadsheetFilename("invoice.pdf"));
});

test("a sheet with no sections yields nothing rather than throwing", () => {
  assert.deepEqual(readSheetDetails([["ACCOUNT NAME:", "Acme"]]), {
    items: [],
    notes: [],
    customerEmail: null,
  });
});

test("a sheet's title and scope are composed, not lifted from the grid", async () => {
  const { sheetScope, sheetTitle } = await import("../src/lib/intake/summary.ts");
  const { text, details } = readWorkbook(installSheet());
  const parsed = parseInstallRequest(text, []);

  const title = sheetTitle(parsed);
  // A plain hyphen, not an em dash: this title goes into the offer SMS, and
  // one character outside GSM-7 halves the characters per billed segment.
  assert.equal(title, "SSDC installation - Luigi's Pizza, Ringwood");
  assert.ok(!title.includes("|"), "a grid row must never become the title");

  const scope = sheetScope(parsed, details);
  assert.ok(scope.includes("Luigi's Pizza"));
  assert.ok(scope.includes("Ringwood, NJ"));
  assert.ok(scope.includes("SINKRITE"), "the sheet's own note leads the scope");
  assert.ok(scope.includes("A-PROGRAM"), "names what is being installed");

  // The point of composing it: a contractor reads a few lines, not the form.
  assert.ok(scope.length < 600, `scope should stay short, got ${scope.length} chars`);
  assert.ok(!scope.includes("PFG SPECIALIST"), "sales fields must not reach the contractor");
  assert.ok(!scope.includes("B9 ACCOUNT NUMBER"));
});
