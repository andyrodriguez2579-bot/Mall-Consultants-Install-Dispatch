"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, Field, inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { bpsToPercent, calculatePricing } from "@/lib/pricing";
import type { PriceListItem } from "@/lib/types";

const toCents = (value: string): number => {
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

export interface PricingDefaults {
  serviceItemId?: string | null;
  customerLaborPriceCents?: number;
  taskCount?: number;
  additionalLaborCents?: number;
  additionalLaborReason?: string | null;
  contractorBps?: number;
  contractorMiles?: number;
  excludedMiles?: number;
  mileageRate?: number;
  estimatedMiles?: number | null;
  materialsCents?: number;
  tollsParkingCents?: number;
  hotelCents?: number;
  otherExpensesCents?: number;
}

/**
 * The pricing calculator, as a form.
 *
 * Everything is derived from the customer labor price: the administrator sets
 * what the customer pays, and the contractor's share, the Mall Consultants
 * share and both totals follow. Nothing here is typed in twice.
 *
 * The figures update as you type using the same arithmetic the database will
 * apply on save (`src/lib/pricing.ts`, held in step with the SQL by
 * test/pricing-parity.test.mjs), so the preview is never a different number
 * from the one that gets stored.
 */
export function PricingPanel({
  priceList,
  defaults = {},
  commuterMiles = 30,
  disabled = false,
}: {
  priceList: PriceListItem[];
  defaults?: PricingDefaults;
  commuterMiles?: number;
  disabled?: boolean;
}) {
  const [serviceId, setServiceId] = useState(defaults.serviceItemId ?? "");
  const [price, setPrice] = useState(
    defaults.customerLaborPriceCents
      ? (defaults.customerLaborPriceCents / 100).toFixed(2)
      : "",
  );
  const [tasks, setTasks] = useState(String(defaults.taskCount ?? 1));
  const [additional, setAdditional] = useState(
    defaults.additionalLaborCents ? (defaults.additionalLaborCents / 100).toFixed(2) : "",
  );
  const [miles, setMiles] = useState(String(defaults.contractorMiles ?? ""));
  const [excluded, setExcluded] = useState(String(defaults.excludedMiles ?? commuterMiles));
  const [rate, setRate] = useState(String(defaults.mileageRate ?? 0.725));
  const [estimated, setEstimated] = useState(String(defaults.estimatedMiles ?? ""));
  const [materials, setMaterials] = useState(
    defaults.materialsCents ? (defaults.materialsCents / 100).toFixed(2) : "",
  );
  const [tolls, setTolls] = useState(
    defaults.tollsParkingCents ? (defaults.tollsParkingCents / 100).toFixed(2) : "",
  );
  const [hotel, setHotel] = useState(
    defaults.hotelCents ? (defaults.hotelCents / 100).toFixed(2) : "",
  );
  const [other, setOther] = useState(
    defaults.otherExpensesCents ? (defaults.otherExpensesCents / 100).toFixed(2) : "",
  );

  /**
   * The contractor's share is per job, not global. A difficult install can be
   * paid above the standard rate without changing what the customer is charged
   * or what every other job pays -- the increase comes out of the Mall
   * Consultants share.
   */
  const [share, setShare] = useState(String(bpsToPercent(defaults.contractorBps ?? 4500)));
  const shareNumber = Number(share);
  const bps =
    Number.isFinite(shareNumber) && shareNumber >= 0 && shareNumber <= 100
      ? Math.round(shareNumber * 100)
      : 4500;

  const byCategory = useMemo(() => {
    const groups = new Map<string, PriceListItem[]>();
    for (const item of priceList) {
      const key = item.category ?? "Other";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [priceList]);

  const result = useMemo(() => {
    try {
      return calculatePricing({
        customerLaborPriceCents: toCents(price),
        taskCount: Number(tasks) || 0,
        additionalLaborCents: toCents(additional),
        contractorBps: bps,
        contractorMiles: Number(miles) || 0,
        excludedMiles: Number(excluded) || 0,
        mileageRate: Number(rate) || 0,
        materialsCents: toCents(materials),
        tollsParkingCents: toCents(tolls),
        hotelCents: toCents(hotel),
        otherExpensesCents: toCents(other),
      });
    } catch {
      return null;
    }
  }, [price, tasks, additional, bps, miles, excluded, rate, materials, tolls, hotel, other]);

  /** Selecting a service fills the customer price from the catalogue. */
  function pickService(id: string) {
    setServiceId(id);
    const item = priceList.find((p) => p.id === id);
    if (item) setPrice((item.customer_labor_price_cents / 100).toFixed(2));
  }

  const selected = priceList.find((p) => p.id === serviceId);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Service and labor"
          description="Set what the customer is charged. Everything else follows from it."
        />
        <div className="space-y-4 p-4 sm:p-5">
          <Field label="Service type" hint="Choosing one fills the customer price from the price list.">
            <select
              name="service_item_id"
              value={serviceId}
              onChange={(e) => pickService(e.target.value)}
              disabled={disabled}
              className={inputClass}
            >
              <option value="">Not from the price list…</option>
              {byCategory.map(([category, group]) => (
                <optgroup key={category} label={category}>
                  {group.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {formatMoney(item.customer_labor_price_cents)}/{item.unit}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <input type="hidden" name="service_type" value={selected?.name ?? ""} />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Customer labor price" required hint="Per task, before quantity.">
              <input
                name="customer_labor_price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={disabled}
                required
                inputMode="decimal"
                placeholder="120.00"
                className={inputClass}
              />
            </Field>
            <Field
              label="Number of tasks"
              required
              hint={selected && !selected.allows_quantity ? "This service is a flat fee." : undefined}
            >
              <input
                name="task_count"
                type="number"
                min={0}
                step="0.5"
                value={tasks}
                onChange={(e) => setTasks(e.target.value)}
                disabled={disabled || (selected ? !selected.allows_quantity : false)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Additional approved labor" hint="Requires your approval.">
              <input
                name="additional_labor"
                value={additional}
                onChange={(e) => setAdditional(e.target.value)}
                disabled={disabled}
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Contractor share for this job"
              required
              hint="Percent of labor revenue. Comes out of the Mall Consultants share, not the customer price."
            >
              <div className="flex items-center gap-2">
                <input
                  name="contractor_percentage"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                  disabled={disabled}
                  required
                  className={inputClass}
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
            </Field>
            <div className="sm:col-span-2 sm:self-end sm:pb-2">
              {bps !== (defaults.contractorBps ?? 4500) ? (
                <p className="text-xs text-amber-800">
                  Above your standard {bpsToPercent(defaults.contractorBps ?? 4500)}%. The
                  customer still pays the same amount; the difference comes off your share.
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Your standard rate. Raise it for a difficult install — the job keeps its
                  own percentage, so nothing else changes.
                </p>
              )}
            </div>
          </div>

          {toCents(additional) > 0 ? (
            <Field label="Reason for the additional labor" required>
              <input
                name="additional_labor_reason"
                defaultValue={defaults.additionalLaborReason ?? ""}
                required
                placeholder="Two extra hours to tee into the water supply"
                className={inputClass}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Mileage"
          description="Paid to the contractor in full. Never part of the labor split."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-4 sm:p-5">
          {/* Miles driven are only known after the trip, so they stay editable
              after dispatch. The rate they are paid at does not -- it is frozen
              with the labor agreement. */}
          <Field label="Contractor miles" hint="Odometer end minus start.">
            <input
              name="contractor_miles"
              type="number"
              min={0}
              step="0.1"
              value={miles}
              onChange={(e) => setMiles(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Excluded / commuter miles">
            <input
              name="excluded_miles"
              type="number"
              min={0}
              step="0.1"
              value={excluded}
              onChange={(e) => setExcluded(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Mileage rate" hint="Dollars per payable mile.">
            <input
              name="mileage_rate"
              type="number"
              min={0}
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              disabled={disabled}
              className={inputClass}
            />
          </Field>
          <Field
            label="Estimated round trip"
            hint="Shown on the job board before anyone accepts."
          >
            <input
              name="estimated_miles"
              type="number"
              min={0}
              step="0.1"
              value={estimated}
              onChange={(e) => setEstimated(e.target.value)}
              disabled={disabled}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Approved reimbursable expenses"
          description="Also paid in full and never split. Approve only what you have receipts for."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-4 sm:p-5">
          {(
            [
              ["materials", "Materials", materials, setMaterials],
              ["tolls_parking", "Tolls and parking", tolls, setTolls],
              ["hotel", "Hotel", hotel, setHotel],
              ["other_expenses", "Other", other, setOther],
            ] as const
          ).map(([name, label, value, setter]) => (
            <Field key={name} label={label}>
              {/* Receipts arrive after the work, so these stay editable too. */}
              <input
                name={name}
                value={value}
                onChange={(e) => setter(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
          ))}
        </div>
      </Card>

      {result ? (
        <Card>
          <CardHeader
            title="Calculation"
            description="Updates as you type. The database recomputes the same figures on save."
          />
          <div className="p-4 sm:p-5">
            <dl className="space-y-1.5 text-sm">
              <Line label="Base labor total" value={result.baseLaborTotalCents} />
              {toCents(additional) > 0 ? (
                <Line label="Additional approved labor" value={toCents(additional)} />
              ) : null}
              <Line label="Total labor revenue" value={result.totalLaborRevenueCents} strong />

              <div className="!mt-3 border-t border-slate-200 pt-3" />

              <Line
                label={`Contractor labor pay (${bpsToPercent(bps)}%)`}
                value={result.contractorLaborPayCents}
              />
              <Line
                label={`Mall Consultants share (${bpsToPercent(10000 - bps)}%)`}
                value={result.mallShareCents}
                muted
              />

              <div className="!mt-3 border-t border-slate-200 pt-3" />

              <Line
                label={`Mileage — ${result.payableMiles} payable miles at $${Number(rate || 0).toFixed(4)}`}
                value={result.mileagePaymentCents}
              />
              <Line label="Reimbursable expenses" value={result.totalExpensesCents} />
            </dl>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-900 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Total contractor payment
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                  {formatMoney(result.totalContractorPaymentCents)}
                </p>
              </div>
              <div className="rounded-lg bg-emerald-700 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-100">
                  Total customer charge
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                  {formatMoney(result.totalCustomerChargeCents)}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              The contractor is shown their labor pay, mileage, expense allowance and
              total — never the customer price or the Mall Consultants share.
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={muted ? "text-slate-500" : "text-slate-600"}>{label}</dt>
      <dd
        className={`tabular-nums ${
          strong ? "font-semibold text-slate-900" : muted ? "text-slate-500" : "text-slate-800"
        }`}
      >
        {formatMoney(value)}
      </dd>
    </div>
  );
}
