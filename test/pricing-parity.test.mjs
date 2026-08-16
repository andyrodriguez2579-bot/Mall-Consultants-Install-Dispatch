/**
 * Parity between the TypeScript calculator and the SQL.
 *
 * The form shows a live total computed in the browser; the database computes
 * and stores the figure that is actually paid. If those two ever disagreed, an
 * administrator would approve one number and a contractor would be paid
 * another. This test makes that disagreement impossible to ship by checking
 * both against the same inputs, including the awkward ones.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { calculatePricing } from "../src/lib/pricing.ts";
import { closePool, query } from "./helpers/db.mjs";

/** Inputs chosen to land on rounding boundaries, not just tidy dollars. */
const CASES = [
  { customerLaborPriceCents: 12000, taskCount: 1 },
  { customerLaborPriceCents: 12000, taskCount: 3 },
  { customerLaborPriceCents: 12040, taskCount: 2, additionalLaborCents: 4060 },
  { customerLaborPriceCents: 1, taskCount: 1 },
  { customerLaborPriceCents: 3, taskCount: 1 },
  { customerLaborPriceCents: 99, taskCount: 1 },
  { customerLaborPriceCents: 101, taskCount: 7 },
  { customerLaborPriceCents: 4999, taskCount: 1.5 },
  { customerLaborPriceCents: 8050, taskCount: 2.5, additionalLaborCents: 1 },
  { customerLaborPriceCents: 25900, taskCount: 1, contractorBps: 5000 },
  { customerLaborPriceCents: 25900, taskCount: 1, contractorBps: 3333 },
  { customerLaborPriceCents: 95900, taskCount: 4, additionalLaborCents: 12345 },
  { customerLaborPriceCents: 0, taskCount: 5 },
  { customerLaborPriceCents: 14500, taskCount: 0 },
];

const MILEAGE = [
  { contractorMiles: 50, excludedMiles: 30, mileageRate: 0.725 },
  { contractorMiles: 30, excludedMiles: 30, mileageRate: 0.7 },
  { contractorMiles: 12, excludedMiles: 30, mileageRate: 0.7 },
  { contractorMiles: 130.5, excludedMiles: 30, mileageRate: 0.7 },
  { contractorMiles: 217.3, excludedMiles: 30, mileageRate: 0.655 },
  { contractorMiles: 0, excludedMiles: 0, mileageRate: 0.725 },
];

const EXPENSES = [
  {},
  { materialsCents: 4235, tollsParkingCents: 1800, hotelCents: 13900, otherExpensesCents: 500 },
  { materialsCents: 1, otherExpensesCents: 2 },
];

test("the calculator and the database agree on every combination", async () => {
  let checked = 0;

  for (const labor of CASES) {
    for (const mileage of MILEAGE) {
      for (const expenses of EXPENSES) {
        const inputs = { ...labor, ...mileage, ...expenses };
        // One line is the equivalent of the old price-times-count input, which
        // keeps these cases comparable against the same SQL primitives.
        const ts = calculatePricing({
          ...inputs,
          lines: [
            {
              unitPriceCents: inputs.customerLaborPriceCents,
              quantity: inputs.taskCount,
            },
          ],
        });

        const [sql] = await query(
          `select
             public.calc_base_labor_cents($1, $2)                            as base_labor,
             public.calc_labor_revenue_cents($1, $2, $3)                     as revenue,
             public.calc_contractor_labor_cents(
               public.calc_labor_revenue_cents($1, $2, $3), $4)              as contractor_labor,
             public.calc_payable_miles($5, $6)                               as payable_miles,
             public.calc_mileage_cents($5, $6, $7)                           as mileage_cents,
             public.calc_expenses_cents($8, $9, $10, $11)                    as expenses_cents`,
          [
            inputs.customerLaborPriceCents,
            inputs.taskCount,
            inputs.additionalLaborCents ?? 0,
            inputs.contractorBps ?? 4500,
            inputs.contractorMiles ?? 0,
            inputs.excludedMiles ?? 0,
            inputs.mileageRate ?? 0.725,
            inputs.materialsCents ?? 0,
            inputs.tollsParkingCents ?? 0,
            inputs.hotelCents ?? 0,
            inputs.otherExpensesCents ?? 0,
          ],
        );

        const where = JSON.stringify(inputs);
        assert.equal(ts.baseLaborTotalCents, sql.base_labor, `base labor ${where}`);
        assert.equal(ts.totalLaborRevenueCents, sql.revenue, `revenue ${where}`);
        assert.equal(ts.contractorLaborPayCents, sql.contractor_labor, `contractor pay ${where}`);
        assert.equal(
          ts.mallShareCents,
          sql.revenue - sql.contractor_labor,
          `mall share ${where}`,
        );
        assert.equal(ts.payableMiles, Number(sql.payable_miles), `payable miles ${where}`);
        assert.equal(ts.mileagePaymentCents, sql.mileage_cents, `mileage ${where}`);
        assert.equal(ts.totalExpensesCents, sql.expenses_cents, `expenses ${where}`);

        // And the two totals the business actually cares about.
        assert.equal(
          ts.totalContractorPaymentCents,
          sql.contractor_labor + sql.mileage_cents + sql.expenses_cents,
          `total contractor payment ${where}`,
        );
        assert.equal(
          ts.totalCustomerChargeCents,
          sql.revenue + sql.mileage_cents + sql.expenses_cents,
          `total customer charge ${where}`,
        );

        checked += 1;
      }
    }
  }

  assert.ok(checked >= 250, `expected a broad sweep, checked ${checked}`);
});

test("the calculator refuses negative inputs rather than computing from them", () => {
  const line = { unitPriceCents: 100, quantity: 1 };
  const bad = [
    { lines: [{ unitPriceCents: -1, quantity: 1 }] },
    { lines: [{ unitPriceCents: 100, quantity: -1 }] },
    // A bad line anywhere in the list, not only the first.
    { lines: [line, { unitPriceCents: 100, quantity: -2 }] },
    { lines: [line], additionalLaborCents: -5 },
    { lines: [line], contractorMiles: -3 },
    { lines: [line], materialsCents: -1 },
    { lines: [line], mileageRate: -0.5 },
  ];

  for (const inputs of bad) {
    assert.throws(() => calculatePricing(inputs), RangeError, JSON.stringify(inputs));
  }

  assert.throws(
    () => calculatePricing({ lines: [line], contractorBps: 10001 }),
    RangeError,
  );
});

test("the split never touches mileage or expenses", () => {
  const withoutExtras = calculatePricing({
    customerLaborPriceCents: 12000,
    taskCount: 1,
  });
  const withExtras = calculatePricing({
    customerLaborPriceCents: 12000,
    taskCount: 1,
    contractorMiles: 200,
    excludedMiles: 30,
    mileageRate: 0.7,
    materialsCents: 5000,
  });

  assert.equal(
    withExtras.contractorLaborPayCents,
    withoutExtras.contractorLaborPayCents,
    "labor pay must not move when mileage or expenses are added",
  );
  assert.equal(withExtras.mallShareCents, withoutExtras.mallShareCents);

  // The contractor receives every cent of the extras.
  const extras = withExtras.mileagePaymentCents + withExtras.totalExpensesCents;
  assert.equal(
    withExtras.totalContractorPaymentCents - withoutExtras.totalContractorPaymentCents,
    extras,
  );
});

test("the worked example, through the calculator", () => {
  const r = calculatePricing({
    lines: [{ unitPriceCents: 12000, quantity: 1 }],
    additionalLaborCents: 0,
    contractorMiles: 50,
    excludedMiles: 30,
    mileageRate: 0.725,
  });

  assert.equal(r.baseLaborTotalCents, 12000);
  assert.equal(r.contractorLaborPayCents, 5400);
  assert.equal(r.mallShareCents, 6600);
  assert.equal(r.payableMiles, 20);
  assert.equal(r.mileagePaymentCents, 1450);
  assert.equal(r.totalContractorPaymentCents, 6850);
  assert.equal(r.totalCustomerChargeCents, 13450);
});

test.after(async () => {
  await closePool();
});
