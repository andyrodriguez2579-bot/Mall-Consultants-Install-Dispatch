"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { type RequestState, createRequest } from "./actions";

const EMPTY: RequestState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Reading…" : "Extract and review"}
    </button>
  );
}

export function NewRequestForm() {
  const [state, action] = useActionState(createRequest, EMPTY);

  return (
    <Card>
      <CardHeader
        title="New request"
        description="Attach the install sheet, paste the email, or both."
      />
      <form action={action} className="space-y-4 p-4 sm:p-5">
        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <label className="block">
            <span className="block text-sm font-medium text-slate-800">Install sheet</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              The workbook exactly as it arrived — .xlsb, .xlsx, .xlsm, .xls or .csv.
              Only the INSTALL sheet is read; the product catalogue is ignored.
            </span>
            <input
              type="file"
              name="workbook"
              accept=".xlsb,.xlsx,.xlsm,.xls,.csv"
              className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
            />
          </label>
          {state.errors?.workbook ? (
            <p className="mt-2 text-xs text-rose-600">{state.errors.workbook}</p>
          ) : null}
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-slate-800">
            Covering email or notes{" "}
            <span className="font-normal text-slate-500">— optional if a sheet is attached</span>
          </span>
          <textarea
            name="raw_text"
            rows={8}
            className={inputClass + " mt-1.5 font-mono text-[13px]"}
            placeholder={`Customer: Simon Property Group
Site: Memorial City Mall
Address: 303 Memorial City Way, Houston, TX 77024
Contact: Danielle Ruiz 713-555-0199
PO#: 44821
Date: 4/22/2026 8:00 AM

Replace 2 SSDC units in the north vestibule and re-commission.`}
          />
        </label>
        {state.errors?.raw_text ? (
          <p className="text-xs text-rose-600">{state.errors.raw_text}</p>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-slate-800">How it arrived</span>
            <select name="source" className={inputClass + " mt-1.5 w-40"}>
              <option value="email">Email</option>
              <option value="paste">Pasted</option>
              <option value="phone">Phone call</option>
              <option value="manual">Entered by hand</option>
            </select>
          </label>
          <Submit />
        </div>
      </form>
    </Card>
  );
}
