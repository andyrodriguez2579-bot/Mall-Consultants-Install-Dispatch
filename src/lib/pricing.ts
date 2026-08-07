/**
 * The pricing calculator.
 *
 * A pure mirror of the SQL in migration 0014, so a form can show a live total
 * without a round trip. The database remains the authority -- these functions
 * exist for preview, and `test/pricing-parity.test.mjs` asserts that the two
 * agree on every case, so the preview can never quietly drift from what is
 * actually stored.
 *
 * Money is integer cents throughout. That is exact: a dollar amount in cents
 * has no representation error, whereas 0.45 * 120.00 in binary floating point
 * does. Rates and quantities are the only fractional values, and they are the
 * only places where rounding is applied -- once, at the end, to the cent.
 */

/** 45% expressed in basis points, the default contractor share. */
export const DEFAULT_CONTRACTOR_BPS = 4500;
export const DEFAULT_MILEAGE_RATE = 0.725;
export const DEFAULT_COMMUTER_MILES = 30;

export interface PricingInputs {
  /** What the customer is charged for one task, in cents. */
  customerLaborPriceCents: number;
  /** Number of tasks or units. */
  taskCount: number;
  /** Additional approved labor charges, in cents. Requires admin approval. */
  additionalLaborCents?: number;
  /** Contractor share in basis points. 4500 = 45%. */
  contractorBps?: number;

  /** Total miles the contractor reported. */
  contractorMiles?: number;
  /** Commuter or otherwise excluded miles. */
  excludedMiles?: number;
  /** Dollars per payable mile. */
  mileageRate?: number;

  /** Approved reimbursable expenses, in cents. */
  materialsCents?: number;
  tollsParkingCents?: number;
  hotelCents?: number;
  otherExpensesCents?: number;
}

export interface PricingResult {
  baseLaborTotalCents: number;
  totalLaborRevenueCents: number;
  contractorLaborPayCents: number;
  mallShareCents: number;

  payableMiles: number;
  mileagePaymentCents: number;

  totalExpensesCents: number;

  totalContractorPaymentCents: number;
  totalCustomerChargeCents: number;
}

/** Reject the nonsensical rather than quietly computing from it. */
const nonNegative = (value: number | undefined, label: string): number => {
  const n = value ?? 0;
  if (!Number.isFinite(n)) throw new RangeError(`${label} must be a number`);
  if (n < 0) throw new RangeError(`${label} cannot be negative`);
  return n;
};

export function calculatePricing(inputs: PricingInputs): PricingResult {
  const price = nonNegative(inputs.customerLaborPriceCents, "Customer labor price");
  const tasks = nonNegative(inputs.taskCount, "Number of tasks");
  const additional = nonNegative(inputs.additionalLaborCents, "Additional labor");
  const bps = inputs.contractorBps ?? DEFAULT_CONTRACTOR_BPS;

  if (bps < 0 || bps > 10000) {
    throw new RangeError("Contractor percentage must be between 0 and 100");
  }

  const miles = nonNegative(inputs.contractorMiles, "Contractor miles");
  const excluded = nonNegative(inputs.excludedMiles, "Excluded miles");
  const rate = nonNegative(inputs.mileageRate ?? DEFAULT_MILEAGE_RATE, "Mileage rate");

  const materials = nonNegative(inputs.materialsCents, "Materials");
  const tolls = nonNegative(inputs.tollsParkingCents, "Tolls and parking");
  const hotel = nonNegative(inputs.hotelCents, "Hotel");
  const other = nonNegative(inputs.otherExpensesCents, "Other expenses");

  const baseLaborTotalCents = Math.round(price * tasks);
  const totalLaborRevenueCents = baseLaborTotalCents + additional;

  const contractorLaborPayCents = Math.round((totalLaborRevenueCents * bps) / 10000);
  // Subtraction, never a second percentage: 45% and 55% each rounded
  // independently would disagree with the total by a cent on odd amounts.
  const mallShareCents = totalLaborRevenueCents - contractorLaborPayCents;

  // Never negative: a trip shorter than the commuter allowance pays no mileage.
  const payableMiles = Math.max(0, miles - excluded);
  const mileagePaymentCents = Math.round(payableMiles * rate * 100);

  const totalExpensesCents = materials + tolls + hotel + other;

  // The split applies to labor only. Mileage and reimbursables pass through
  // whole to the contractor and are added after it.
  const totalContractorPaymentCents =
    contractorLaborPayCents + mileagePaymentCents + totalExpensesCents;
  const totalCustomerChargeCents =
    totalLaborRevenueCents + mileagePaymentCents + totalExpensesCents;

  return {
    baseLaborTotalCents,
    totalLaborRevenueCents,
    contractorLaborPayCents,
    mallShareCents,
    payableMiles,
    mileagePaymentCents,
    totalExpensesCents,
    totalContractorPaymentCents,
    totalCustomerChargeCents,
  };
}

/** Contractor share of a single catalogue price, for the price list screen. */
export function catalogueShares(customerPriceCents: number, bps = DEFAULT_CONTRACTOR_BPS) {
  const contractor = Math.round((customerPriceCents * bps) / 10000);
  return { contractorLaborPayCents: contractor, mallShareCents: customerPriceCents - contractor };
}

export const bpsToPercent = (bps: number): string =>
  (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);

export const percentToBps = (percent: number): number => Math.round(percent * 100);

/**
 * What a contractor is shown on the job board. Deliberately a distinct shape
 * from PricingResult so that a customer-side figure cannot reach the contractor
 * surface by accident -- it simply is not in the type.
 */
export interface ContractorOfferView {
  laborPayCents: number;
  mileagePaymentCents: number;
  expenseAllowanceCents: number;
  totalExpectedPaymentCents: number;
  estimatedMiles: number | null;
  payableMiles: number;
  mileageRate: number;
}

export function contractorView(job: {
  contractor_labor_pay_cents: number;
  mileage_payment_cents: number;
  total_expenses_cents: number;
  contractor_pay_cents: number;
  estimated_miles: number | null;
  payable_miles: number;
  mileage_rate: number;
}): ContractorOfferView {
  return {
    laborPayCents: job.contractor_labor_pay_cents,
    mileagePaymentCents: job.mileage_payment_cents,
    expenseAllowanceCents: job.total_expenses_cents,
    totalExpectedPaymentCents: job.contractor_pay_cents,
    estimatedMiles: job.estimated_miles,
    payableMiles: job.payable_miles,
    mileageRate: job.mileage_rate,
  };
}

/**
 * Estimated mileage pay for an offer, before any miles have been driven.
 * Uses the estimated round trip from the contractor's designated starting
 * point, less the commuter allowance.
 */
export function estimatedMileagePayCents(
  estimatedMiles: number | null,
  commuterMiles = DEFAULT_COMMUTER_MILES,
  rate = DEFAULT_MILEAGE_RATE,
): number {
  if (estimatedMiles === null || !Number.isFinite(estimatedMiles)) return 0;
  return Math.round(Math.max(0, estimatedMiles - commuterMiles) * rate * 100);
}
