"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Card,
  ErrorBanner,
  Field,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import {
  type SignInState,
  requestEmailSignInLink,
  requestSmsSignInLink,
  signInWithPassword,
} from "./actions";

const EMPTY: SignInState = {};

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", true)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function SignInForms() {
  // Contractors are the overwhelming majority of sign-ins, so their tab leads.
  const [tab, setTab] = useState<"contractor" | "admin">("contractor");

  return (
    <Card className="p-5">
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
      >
        {(
          [
            ["contractor", "Contractor"],
            ["admin", "Administrator"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              tab === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "contractor" ? <ContractorForm /> : <AdminForm />}
    </Card>
  );
}

/**
 * Both carriers are offered, and neither is presented as the fallback.
 *
 * A contractor who declined text messages has to be able to reach their own
 * account, or consenting to SMS would be a condition of using the system --
 * which is the opposite of what the consent notice promises them.
 */
function ContractorForm() {
  const [by, setBy] = useState<"sms" | "email">("sms");

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        We will send you a sign-in link. No password needed.
      </p>

      <div className="flex gap-2">
        {(
          [
            ["sms", "Text me"],
            ["email", "Email me"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={by === key}
            onClick={() => setBy(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
              by === key
                ? "bg-blue-50 text-blue-800 ring-blue-300"
                : "text-slate-600 ring-slate-300 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {by === "sms" ? <SmsLinkForm /> : <EmailLinkForm />}
    </div>
  );
}

function SmsLinkForm() {
  const [state, action] = useActionState(requestSmsSignInLink, EMPTY);

  if (state.sent) {
    return (
      <SuccessBanner>
        If that number belongs to an approved contractor, a sign-in link is on its way.
        It is good for 15 minutes and can only be used once.
      </SuccessBanner>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      <Field label="Mobile number" required>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="(713) 555-0201"
          className={inputClass}
        />
      </Field>

      <SubmitButton>Text me a sign-in link</SubmitButton>
    </form>
  );
}

function EmailLinkForm() {
  const [state, action] = useActionState(requestEmailSignInLink, EMPTY);

  if (state.sent) {
    return (
      <SuccessBanner>
        If that address belongs to an approved contractor, a sign-in link is on its way.
        It is good for 15 minutes and can only be used once.
      </SuccessBanner>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      {/* Named apart from the administrator form's `email` so a password
          manager cannot offer admin credentials against a link request. */}
      <Field label="Email address" required>
        <input
          name="contractor_email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className={inputClass}
        />
      </Field>

      <SubmitButton>Email me a sign-in link</SubmitButton>
    </form>
  );
}

function AdminForm() {
  const [state, action] = useActionState(signInWithPassword, EMPTY);

  return (
    <form action={action} className="space-y-4">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      <Field label="Email" required>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
        />
      </Field>

      <Field label="Password" required>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>

      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
