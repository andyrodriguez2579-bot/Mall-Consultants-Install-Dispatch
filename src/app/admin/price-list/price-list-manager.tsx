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
import type { PriceListItem } from "@/lib/types";
import {
  type PriceListState,
  createPriceListItem,
  setPriceListItemActive,
  updatePriceListItem,
} from "./actions";

const EMPTY: PriceListState = {};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function PriceListManager({ items }: { items: PriceListItem[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active = items.filter((i) => i.is_active);
  const retired = items.filter((i) => !i.is_active);

  const categories = [...new Set(active.map((i) => i.category ?? "Other"))];

  return (
    <div className="space-y-5">
      {categories.map((category) => (
        <Card key={category}>
          <CardHeader title={category} />
          <ul className="divide-y divide-slate-100">
            {active
              .filter((i) => (i.category ?? "Other") === category)
              .map((item) =>
                editing === item.id ? (
                  <li key={item.id} className="p-4 sm:p-5">
                    <ItemForm
                      item={item}
                      onDone={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{item.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{item.code}</p>
                      {item.description ? (
                        <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatMoney(item.unit_price_cents)}
                        <span className="font-normal text-slate-400">/{item.unit}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditing(item.id)}
                        className="text-sm font-medium text-blue-700"
                      >
                        Edit
                      </button>
                      <form action={setPriceListItemActive}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="is_active" value="false" />
                        <button type="submit" className="text-sm font-medium text-slate-400 hover:text-rose-600">
                          Retire
                        </button>
                      </form>
                    </div>
                  </li>
                ),
              )}
          </ul>
        </Card>
      ))}

      {retired.length > 0 ? (
        <Card>
          <CardHeader
            title="Retired"
            description="Hidden from new jobs. Existing jobs that used these are unaffected."
          />
          <ul className="divide-y divide-slate-100">
            {retired.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <span className="text-sm text-slate-500">
                  {item.name}
                  <span className="ml-2 font-mono text-[11px] text-slate-400">{item.code}</span>
                </span>
                <form action={setPriceListItemActive}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="is_active" value="true" />
                  <button type="submit" className="text-sm font-medium text-blue-700">
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {adding ? (
        <Card>
          <CardHeader title="New work item" />
          <div className="p-4 sm:p-5">
            <ItemForm onDone={() => setAdding(false)} />
          </div>
        </Card>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={buttonClass("secondary")}>
          Add a work item
        </button>
      )}
    </div>
  );
}

function ItemForm({ item, onDone }: { item?: PriceListItem; onDone: () => void }) {
  const [state, action] = useActionState(
    item ? updatePriceListItem : createPriceListItem,
    EMPTY,
  );
  const err = state.errors ?? {};

  return (
    <form action={action} className="space-y-4">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}
      {state.success ? <SuccessBanner>{state.success}</SuccessBanner> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err.name} required>
          <input name="name" defaultValue={item?.name} required className={inputClass} />
        </Field>
        <Field label="Code" error={err.code} required hint="Short identifier, e.g. SSDC-SWAP.">
          <input
            name="code"
            defaultValue={item?.code}
            required
            className={inputClass + " font-mono uppercase"}
          />
        </Field>
        <Field label="Contractor rate (USD)" error={err.unit_price_cents} required>
          <input
            name="unit_price"
            defaultValue={item ? (item.unit_price_cents / 100).toFixed(2) : ""}
            required
            inputMode="decimal"
            placeholder="180.00"
            className={inputClass}
          />
        </Field>
        <Field label="Unit" error={err.unit} hint="each, hour, day…">
          <input name="unit" defaultValue={item?.unit ?? "each"} className={inputClass} />
        </Field>
        <Field label="Category" error={err.category}>
          <input name="category" defaultValue={item?.category ?? ""} className={inputClass} />
        </Field>
      </div>

      <Field label="Description" error={err.description}>
        <textarea name="description" rows={2} defaultValue={item?.description ?? ""} className={inputClass} />
      </Field>

      <div className="flex gap-2">
        <Submit label={item ? "Save" : "Add work item"} />
        <button type="button" onClick={onDone} className={buttonClass("secondary")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
