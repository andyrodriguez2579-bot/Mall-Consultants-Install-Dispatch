"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, ErrorBanner, Field, SuccessBanner, buttonClass, inputClass } from "@/components/ui";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";
import { createClient } from "@/lib/supabase/browser";

/**
 * Where a Supabase password-recovery link lands.
 *
 * The token arrives as a URL fragment (`#access_token=...&type=recovery`),
 * which never reaches a server -- only a client can read it. The Supabase
 * browser client parses it automatically on creation (`detectSessionInUrl`,
 * on by default) and turns it into a real, if temporary, session; from there
 * setting a new password is an ordinary authenticated call.
 *
 * This has to be its own page rather than the root `/`: the root page
 * redirects server-side before any client script runs, and a redirect drops
 * the fragment -- the token would be gone before this could ever read it.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      } else {
        setLinkError(
          "This link is invalid or has expired. Request a new one from Supabase, or ask an administrator.",
        );
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two don't match.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push("/admin"), 1500);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">{ORG_NAME}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{PRODUCT_NAME}</h1>
      </div>

      <Card className="p-5">
        <CardHeader title="Set a new password" />
        <div className="p-4 sm:p-5">
          {linkError ? (
            <ErrorBanner>{linkError}</ErrorBanner>
          ) : success ? (
            <SuccessBanner>Password updated. Taking you to the dashboard…</SuccessBanner>
          ) : !ready ? (
            <p className="text-sm text-slate-500">Checking your link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error ? <ErrorBanner>{error}</ErrorBanner> : null}
              <Field label="New password" required>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Confirm password" required>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className={inputClass}
                />
              </Field>
              <button type="submit" disabled={pending} className={buttonClass("primary", true)}>
                {pending ? "Saving…" : "Set password"}
              </button>
            </form>
          )}
        </div>
      </Card>
    </main>
  );
}
