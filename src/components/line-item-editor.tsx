"use client";

import { useMemo, useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { PriceListItem } from "@/lib/types";

export interface EditableLineItem {
  key: string;
  price_list_item_id: string | null;
  code: string | null;
  description: string;
  unit: string;
  unit_price_cents: number;
  quantity: number;
}

/**
 * Builds a job's contractor payment from priced work items.
 *
 * The total is derived, never typed: pick the items and the quantities and the
 * figure follows, which is what makes pay consistent across jobs and traceable
 * afterwards. An unusual job can still be priced by hand, but that is an
 * explicit override elsewhere on the form rather than a quiet edit here.
 *
 * Rows carry their own copy of the description and unit price rather than
 * pointing at the catalogue, so re-pricing the catalogue later cannot change
 * what a contractor has already been offered.
 */
export function LineItemEditor({
  priceList,
  initialItems,
  disabled = false,
}: {
  priceList: PriceListItem[];
  initialItems: EditableLineItem[];
  disabled?: boolean;
}) {
  const [items, setItems] = useState<EditableLineItem[]>(initialItems);
  const [picker, setPicker] = useState("");

  const total = useMemo(
    () => items.reduce((sum, li) => sum + Math.round(li.unit_price_cents * li.quantity), 0),
    [items],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<string, PriceListItem[]>();
    for (const item of priceList) {
      const key = item.category ?? "Other";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [priceList]);

  function addFromCatalogue(itemId: string) {
    const source = priceList.find((p) => p.id === itemId);
    if (!source) return;

    setItems((prev) => {
      // Adding something already on the job bumps its quantity rather than
      // creating a duplicate line.
      const existing = prev.findIndex((li) => li.price_list_item_id === source.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing]!, quantity: next[existing]!.quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          price_list_item_id: source.id,
          code: source.code,
          description: source.name,
          unit: source.unit,
          unit_price_cents: source.unit_price_cents,
          quantity: 1,
        },
      ];
    });
    setPicker("");
  }

  function addCustomLine() {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        price_list_item_id: null,
        code: null,
        description: "",
        unit: "each",
        unit_price_cents: 0,
        quantity: 1,
      },
    ]);
  }

  function update(key: string, patch: Partial<EditableLineItem>) {
    setItems((prev) => prev.map((li) => (li.key === key ? { ...li, ...patch } : li)));
  }

  function remove(key: string) {
    setItems((prev) => prev.filter((li) => li.key !== key));
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No work items yet. Add them from the price list below, and the contractor
          payment is calculated for you.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {items.map((li) => (
            <li key={li.key} className="p-3">
              {/* The server reads these as parallel arrays. */}
              <input type="hidden" name="li_price_list_item_id" value={li.price_list_item_id ?? ""} />
              <input type="hidden" name="li_code" value={li.code ?? ""} />
              <input type="hidden" name="li_unit" value={li.unit} />

              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    name="li_description"
                    value={li.description}
                    onChange={(e) => update(li.key, { description: e.target.value })}
                    disabled={disabled}
                    required
                    placeholder="What the contractor is doing"
                    className={inputClass}
                  />
                  {li.code ? (
                    <span className="mt-1 inline-block font-mono text-[11px] text-slate-400">
                      {li.code}
                    </span>
                  ) : null}
                </div>

                <label className="w-20">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Qty
                  </span>
                  <input
                    name="li_quantity"
                    type="number"
                    min={0}
                    step="0.5"
                    value={li.quantity}
                    onChange={(e) => update(li.key, { quantity: Number(e.target.value) })}
                    disabled={disabled}
                    className={inputClass + " mt-1 px-2 text-right"}
                  />
                </label>

                <label className="w-28">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Rate
                  </span>
                  <input
                    // Edited in dollars, stored in cents.
                    value={(li.unit_price_cents / 100).toFixed(2)}
                    onChange={(e) =>
                      update(li.key, {
                        unit_price_cents: Math.round((Number(e.target.value) || 0) * 100),
                      })
                    }
                    disabled={disabled}
                    inputMode="decimal"
                    className={inputClass + " mt-1 px-2 text-right"}
                  />
                  <input
                    type="hidden"
                    name="li_unit_price_cents"
                    value={li.unit_price_cents}
                  />
                </label>

                <div className="w-24 pt-5 text-right">
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(Math.round(li.unit_price_cents * li.quantity))}
                  </span>
                </div>

                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => remove(li.key)}
                    aria-label={`Remove ${li.description || "line"}`}
                    className="pt-5 text-sm font-medium text-slate-400 hover:text-rose-600"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3">
        <span className="text-sm font-medium text-slate-300">Contractor pay</span>
        <span className="text-lg font-bold tabular-nums text-white">
          {formatMoney(total)}
        </span>
      </div>

      {!disabled ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-800">
              Add from price list
            </span>
            <select
              value={picker}
              onChange={(e) => addFromCatalogue(e.target.value)}
              className={inputClass + " mt-1.5"}
            >
              <option value="">Choose a work item…</option>
              {byCategory.map(([category, group]) => (
                <optgroup key={category} label={category}>
                  {group.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {formatMoney(item.unit_price_cents)}/{item.unit}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button type="button" onClick={addCustomLine} className={buttonClass("secondary")}>
            Add custom line
          </button>
        </div>
      ) : null}
    </div>
  );
}
