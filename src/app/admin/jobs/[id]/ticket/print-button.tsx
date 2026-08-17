"use client";

import { buttonClass } from "@/components/ui";

/**
 * The browser's own print dialog, which is also how a phone or a desktop saves
 * the ticket as a PDF. No PDF library is involved: the page is already laid out
 * for paper, and print-to-PDF produces a smaller, sharper, selectable file than
 * rasterising the DOM would.
 */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}>
      Print / Save as PDF
    </button>
  );
}
