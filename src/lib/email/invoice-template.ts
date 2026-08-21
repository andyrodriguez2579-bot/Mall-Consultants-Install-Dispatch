/**
 * The email an invoice goes out as.
 *
 * Plain text, like the install-request emails: this reaches a bookkeeper's
 * inbox, not a design review, and a wall of numbers reads better as a fixed-
 * width list than as an HTML table forwarded through three mail clients.
 *
 * Money is formatted locally rather than importing `formatMoney` from
 * `@/lib/format`, and the org name is a parameter rather than an import of
 * `ORG_NAME` -- both keep this a pure function of its input with no cross-file
 * value import, which is what lets it be tested by running it directly with
 * `node --test` (see the note on the same choice in install-templates.ts).
 */

export interface InvoiceSummary {
  invoiceNumber: number;
  jobNumber: string;
  customerName: string;
  siteAddress: string;
  accountNumber: string | null;
  billToName: string | null;
  billToAddress: string | null;
  notes: string | null;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

function quantityText(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

export function invoiceEmail(
  summary: InvoiceSummary,
  lines: InvoiceLine[],
  subtotalCents: number,
  orgName: string,
): { subject: string; body: string } {
  const rule = "-".repeat(60);

  const out: string[] = [
    `Invoice INV-${summary.invoiceNumber}`,
    `Job ${summary.jobNumber} -- ${summary.customerName}`,
    summary.siteAddress,
  ];
  if (summary.accountNumber) out.push(`Account ${summary.accountNumber}`);
  out.push("");

  if (summary.billToName || summary.billToAddress) {
    out.push("Bill to:");
    if (summary.billToName) out.push(summary.billToName);
    if (summary.billToAddress) out.push(summary.billToAddress);
    out.push("");
  }

  out.push(rule);
  for (const line of lines) {
    out.push(
      `${line.description}`,
      `  ${quantityText(line.quantity)} x ${money(line.unitPriceCents)} = ${money(line.lineTotalCents)}`,
    );
  }
  out.push(rule, `Total: ${money(subtotalCents)}`, "");

  if (summary.notes) out.push(summary.notes, "");

  out.push(orgName);

  return {
    subject: `Invoice INV-${summary.invoiceNumber} -- ${summary.customerName} (Job ${summary.jobNumber})`,
    body: out.join("\n"),
  };
}
