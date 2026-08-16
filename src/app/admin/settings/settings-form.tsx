"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  Field,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { calculatePricing, percentToBps } from "@/lib/pricing";
import { type SettingsState, updateSettings } from "./actions";

const EMPTY: SettingsState = {};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Saving…" : "Save settings"}
    </button>
  );
}

export function SettingsForm({
  contractorBps,
  mileageRate,
  commuterMiles,
}: {
  contractorBps: number;
  mileageRate: number;
  commuterMiles: number;
}) {
  const [state, action] = useActionState(updateSettings, EMPTY);
  const [percent, setPercent] = useState(String(contractorBps / 100));
  const [rate, setRate] = useState(String(mileageRate));
  const [commuter, setCommuter] = useState(String(commuterMiles));

  const contractorPct = Number(percent) || 0;
  const mallPct = 100 - contractorPct;

  // A live worked example, so the effect of a change is visible before saving.
  const example = calculatePricing({
    lines: [{ unitPriceCents: 12000, quantity: 1 }],
    contractorBps: percentToBps(contractorPct),
    contractorMiles: 50,
    excludedMiles: Number(commuter) || 0,
    mileageRate: Number(rate) || 0,
  });

  return (
    <form action={action} className="space-y-5">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
      {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

      <Card>
        <CardHeader title="Labor split" description="How total labor revenue is divided." />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Contractor percentage" required hint="Of total labor revenue.">
            <div className="flex items-center gap-2">
              <input
                name="contractor_percentage_bps"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                required
                className={inputClass + " w-32"}
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </Field>
          <Field label="Mall Consultants percentage" hint="Derived — always the remainder.">
            <div className="flex items-center gap-2">
              <input
                value={mallPct.toFixed(2).replace(/\.00$/, "")}
                readOnly
                className={inputClass + " w-32 bg-slate-100 text-slate-600"}
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </Field>
        </div>
        <p className="px-4 pb-4 text-xs text-slate-500 sm:px-5">
          The Mall Consultants share is always calculated as revenue minus the contractor
          share, never as its own percentage — that is what keeps the two adding up to
          the penny on odd amounts.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Mileage"
          description="Paid to the contractor in full, never part of the split."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Rate per payable mile" required>
            <input
              name="mileage_rate"
              type="number"
              min={0}
              max={10}
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
              className={inputClass + " w-40"}
            />
          </Field>
          <Field
            label="Commuter deduction (miles)"
            required
            hint="Deducted from each trip before mileage is paid."
          >
            <input
              name="commuter_deduction_miles"
              type="number"
              min={0}
              max={500}
              step="0.1"
              value={commuter}
              onChange={(e) => setCommuter(e.target.value)}
              required
              className={inputClass + " w-40"}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Worked example"
          description="A $120.00 service, one task, 50 miles driven."
        />
        <dl className="space-y-1.5 p-4 text-sm sm:p-5">
          <Row label="Total labor revenue" value={example.totalLaborRevenueCents} />
          <Row
            label={`Contractor labor pay (${contractorPct}%)`}
            value={example.contractorLaborPayCents}
          />
          <Row
            label={`Mall Consultants share (${mallPct.toFixed(2).replace(/\.00$/, "")}%)`}
            value={example.mallShareCents}
          />
          <Row
            label={`Mileage — ${example.payableMiles} payable miles`}
            value={example.mileagePaymentCents}
          />
          <div className="!mt-3 border-t border-slate-200 pt-3" />
          <Row label="Total contractor payment" value={example.totalContractorPaymentCents} strong />
          <Row label="Total customer charge" value={example.totalCustomerChargeCents} strong />
        </dl>
      </Card>

      <Save />
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-800"}`}>
        {formatMoney(value)}
      </dd>
    </div>
  );
}
