"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  CardHeader,
  ErrorBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import type { SheetDetails } from "@/lib/intake/workbook";
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

interface SheetState {
  fileName: string;
  text: string;
  details: SheetDetails;
  sheetsUsed: string[];
}

export function NewRequestForm() {
  const [state, action] = useActionState(createRequest, EMPTY);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  /**
   * The workbook is read here, in the browser, and only the extracted text is
   * sent on.
   *
   * These files run to several megabytes because of the embedded product
   * photographs, and every request to a Vercel deployment is capped at 4.5 MB
   * -- a platform limit, not a setting -- so uploading one returns 413 before
   * any code of ours runs. Reading it here sidesteps the limit entirely: what
   * reaches the server is a few kilobytes of text.
   *
   * The parser is loaded on demand so its weight is only paid by someone who
   * actually attaches a sheet.
   */
  async function handleFile(file: File | undefined) {
    setReadError(null);
    if (!file) {
      setSheet(null);
      return;
    }

    setReading(true);
    try {
      const { readWorkbook, isSpreadsheetFilename } = await import("@/lib/intake/workbook");

      if (!isSpreadsheetFilename(file.name)) {
        setSheet(null);
        setReadError(`${file.name} is not a spreadsheet — expected .xlsb, .xlsx, .xlsm, .xls or .csv.`);
        return;
      }

      const result = readWorkbook(await file.arrayBuffer());
      if (!result.text.trim()) {
        setSheet(null);
        setReadError("That workbook has no readable install sheet.");
        return;
      }

      setSheet({
        fileName: file.name,
        text: result.text,
        details: result.details,
        sheetsUsed: result.sheetsUsed,
      });
    } catch (cause) {
      setSheet(null);
      setReadError(
        `Could not read that workbook: ${cause instanceof Error ? cause.message : "unreadable"}`,
      );
    } finally {
      setReading(false);
    }
  }

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
              accept=".xlsb,.xlsx,.xlsm,.xls,.csv"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
            />
          </label>

          {reading ? (
            <p className="mt-2 text-xs text-slate-500">Reading the sheet…</p>
          ) : null}
          {readError ? <p className="mt-2 text-xs text-rose-600">{readError}</p> : null}
          {state.errors?.sheet_text ? (
            <p className="mt-2 text-xs text-rose-600">{state.errors.sheet_text}</p>
          ) : null}

          {sheet ? (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
              <p className="text-sm font-medium text-slate-900">{sheet.fileName}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Read {sheet.sheetsUsed.join(", ") || "no sheets"} ·{" "}
                {sheet.details.items.length > 0
                  ? `${sheet.details.items.length} items found`
                  : "no items found"}
                {sheet.details.notes.length > 0 ? " · notes found" : ""}
              </p>
              {/* The extracted text travels as a form field, not the file. */}
              <input type="hidden" name="sheet_text" value={sheet.text} />
              <input
                type="hidden"
                name="details"
                value={JSON.stringify(sheet.details)}
              />
              <input type="hidden" name="sheet_name" value={sheet.fileName} />
            </div>
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
