"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ErrorBanner, buttonClass } from "@/components/ui";
import { type CompleteSignInState, completeSignIn } from "./actions";

const EMPTY: CompleteSignInState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", true)}>
      {pending ? "Signing you in…" : "Sign in"}
    </button>
  );
}

export function SignInButton({ token }: { token: string }) {
  const [state, action] = useActionState(completeSignIn, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error ? (
        <ErrorBanner>
          {state.error}{" "}
          <a href="/sign-in" className="font-semibold underline underline-offset-2">
            Request a new link
          </a>
          .
        </ErrorBanner>
      ) : null}
      <Submit />
    </form>
  );
}
