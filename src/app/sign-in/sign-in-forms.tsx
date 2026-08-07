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

function ContractorForm() {
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
      <p className="text-sm text-slate-600">
        Enter the mobile number on your account and we will text you a sign-in link.
        No password needed.
      </p>

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
