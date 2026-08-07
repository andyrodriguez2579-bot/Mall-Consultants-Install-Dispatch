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
        description="Paste the email, work order or phone note exactly as you received it."
      />
      <form action={action} className="space-y-4 p-4 sm:p-5">
        {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

        <label className="block">
          <span className="sr-only">Request text</span>
          <textarea
            name="raw_text"
            rows={10}
            required
            className={inputClass + " font-mono text-[13px]"}
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
              <option value="paste">Pasted</option>
              <option value="email">Email</option>
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
