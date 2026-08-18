"use client";

import { useState } from "react";
import { Card, CardHeader, buttonClass } from "@/components/ui";

/**
 * The link to hand out, with one button that copies it.
 *
 * Shown as text as well as copied, because it gets read down a phone line as
 * often as it gets pasted.
 */
export function ApplyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Your apply link"
        description="Send this to anyone you want on the roster. They fill in their own details, which is one fewer place a mobile number gets mistyped."
      />
      <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800 ring-1 ring-inset ring-slate-200">
          {url}
        </code>
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access can be refused; the URL is on screen to select.
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </Card>
  );
}
