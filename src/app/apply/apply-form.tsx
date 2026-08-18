"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  ErrorBanner,
  Field,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { ORG_NAME } from "@/lib/branding";
import { SMS_CONSENT_OPTIONAL_NOTE, SMS_CONSENT_TEXT } from "@/lib/consent";
import { type ApplyState, submitApplication } from "./actions";

const EMPTY: ApplyState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", true)}>
      {pending ? "Sending…" : "Send my application"}
    </button>
  );
}

export function ApplyForm() {
  const [state, action] = useActionState(submitApplication, EMPTY);

  if (state.submitted) {
    return (
      <SuccessBanner>
        <span className="font-semibold">Thank you.</span> Your application has been
        received. We review these by hand, and someone will contact you about next
        steps. There is nothing else you need to do.
      </SuccessBanner>
    );
  }

  const err = state.errors ?? {};

  return (
    <form action={action} className="space-y-5">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={err.full_name}>
            <input name="full_name" required autoComplete="name" className={inputClass} />
          </Field>
          <Field label="Business name" error={err.company_name}>
            <input
              name="company_name"
              autoComplete="organization"
              className={inputClass}
            />
          </Field>
          <Field label="Mobile number" required error={err.phone}>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="(516) 555-0142"
              className={inputClass}
            />
          </Field>
          <Field label="Email address" required error={err.email}>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className={inputClass}
            />
          </Field>
          <Field label="City you work from" error={err.city}>
            <input name="city" autoComplete="address-level2" className={inputClass} />
          </Field>
          <Field label="State" error={err.state_code}>
            <input
              name="state_code"
              maxLength={2}
              placeholder="NY"
              autoComplete="address-level1"
              className={inputClass + " uppercase"}
            />
          </Field>
          <Field label="How far will you travel? (miles)" error={err.max_travel_miles}>
            <input
              name="max_travel_miles"
              inputMode="numeric"
              placeholder="50"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Your experience" error={err.experience}>
          <textarea
            name="experience"
            rows={4}
            placeholder="Plumbing, dispenser installs, kitchen equipment, licences you hold, who you have worked for."
            className={inputClass}
          />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        {/* Unticked by default and stated as optional, both deliberately. A2P
            campaign review rejects opt-in that is a condition of the service,
            and a pre-ticked box is not consent that anyone gave. */}
        <label className="flex gap-3 text-sm leading-relaxed text-slate-800">
          <input
            type="checkbox"
            name="sms_opt_in"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
          />
          <span>{SMS_CONSENT_TEXT}</span>
        </label>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          {SMS_CONSENT_OPTIONAL_NOTE}
        </p>

        <label className="flex gap-3 text-sm leading-relaxed text-slate-800">
          <input
            type="checkbox"
            name="accepted_terms"
            required
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
          />
          <span>
            I have read the{" "}
            <Link href="/privacy" className="font-medium text-blue-700 underline">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="font-medium text-blue-700 underline">
              Terms of Use
            </Link>
            , and the details above are mine and correct.
          </span>
        </label>
        {err.accepted_terms ? (
          <p className="text-xs text-rose-600">{err.accepted_terms}</p>
        ) : null}
      </Card>

      <Submit />

      <p className="text-xs leading-relaxed text-slate-500">
        {ORG_NAME} reviews every application by hand. Sending this does not create
        an account, and does not guarantee work.
      </p>
    </form>
  );
}
