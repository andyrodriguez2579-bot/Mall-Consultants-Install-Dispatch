import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { readEquipment, readWorkbook, isSpreadsheetFilename } from "../src/lib/intake/workbook.ts";
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
    ["", "", "", "", "", "High Hood Conveyor"],
    ["", "", "", "", "", "96522211", "High Hood Vent Cowl", "3"],
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

test("the parts table is read by column, with quantities and machine grouping", () => {
  const { equipment } = readWorkbook(installSheet());

  assert.equal(equipment.length, 3);

  assert.deepEqual(equipment[0], {
    group: "Standard Height Conveyor",
    partNumber: "96522180",
    description: "Standard Hood Vent Cowl",
    quantity: 2,
  });

  // Quantity in parentheses, and quantity in its own column, both understood.
  assert.equal(equipment[1].quantity, 4);
  assert.equal(equipment[2].quantity, 3);

  // A second machine starts a new group rather than continuing the first.
  assert.equal(equipment[2].group, "High Hood Conveyor");
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

test("an empty parts table yields no equipment rather than throwing", () => {
  assert.deepEqual(readEquipment([["ACCOUNT NAME:", "Acme"]]), []);
});
