"use client";

/**
 * The boundary of last resort: a failure in the root layout itself.
 *
 * At this point the layout that would normally provide <html> and <body> did
 * not render, so this component has to supply them. Deliberately styled with
 * inline rules rather than the design system, because whatever broke may well
 * be the thing that loads the stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "4rem 1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          color: "#0f172a",
          background: "#ffffff",
        }}
      >
        <div style={{ maxWidth: "42rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            The application failed to start
          </h1>
          <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#475569" }}>
            This is usually a configuration problem rather than a broken page --
            a missing or malformed environment variable, most often after a
            deployment.
          </p>

          {error.digest ? (
            <p style={{ marginTop: "1.5rem", fontSize: "0.8125rem", color: "#475569" }}>
              Reference:{" "}
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
                {error.digest}
              </span>
              <br />
              Search that in Vercel &rarr; Logs to see the full error.
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              border: 0,
              borderRadius: "0.5rem",
              background: "#1d4ed8",
              color: "#ffffff",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
