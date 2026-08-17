"use client";

import { useEffect } from "react";

/**
 * What a crash looks like instead of a blank page.
 *
 * Without a boundary Next renders its last-resort fallback -- "a client-side
 * exception has occurred", no message, nothing to act on -- and the person
 * looking at it cannot tell a broken deployment from a broken record.
 *
 * The digest is the important part. Next deliberately withholds server error
 * messages from the browser in production, because they can carry query text
 * and connection details; what it does expose is a hash that appears beside the
 * full stack in the platform logs. Printing it here is what turns "it broke"
 * into a line someone can search for.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-rose-700">
        Something went wrong
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">
        This page could not be loaded
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        The rest of the system is unaffected. Try again, and if it keeps
        happening send whatever appears below.
      </p>

      <div className="mt-6 rounded-lg border border-slate-300 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Details
        </p>
        {error.message ? (
          <p className="mt-2 break-words font-mono text-xs text-slate-800">
            {error.message}
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-600">
            No message was returned. The error happened on the server, so its
            text is withheld from the browser -- the reference below is how to
            find it.
          </p>
        )}
        {error.digest ? (
          <p className="mt-3 text-xs text-slate-600">
            Reference:{" "}
            <span className="select-all font-mono font-semibold text-slate-900">
              {error.digest}
            </span>
            <br />
            Search that in Vercel &rarr; Logs to see the full error.
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
        <a
          href="/admin"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300"
        >
          Back to dashboard
        </a>
      </div>
    </main>
  );
}
