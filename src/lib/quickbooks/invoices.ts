import { quickbooksApiRequest } from "./client";
import type { QuickbooksConnection } from "./connection";

/**
 * Mirroring an invoice into QuickBooks, for Mall Consultants' own records.
 *
 * Deliberately one line for the invoice's total rather than one QBO line per
 * item: a real line-for-line mirror needs a QBO Item (and that Item needs an
 * income account) for every kind of work Mall Consultants bills for, none of
 * which exist yet in a fresh company and none of which can be guessed at
 * blind. One line, correctly totalled, is a safe default that still gives an
 * accurate record; itemising further is a place to extend once the
 * connection is live and the chart of accounts is known.
 */

interface QboQueryResponse<T> {
  QueryResponse?: { [key: string]: T[] | number | undefined };
}

async function findOrCreateCustomer(connection: QuickbooksConnection, displayName: string): Promise<string> {
  const name = displayName.trim() || "Mall Consultants customer";
  const escaped = name.replace(/'/g, "''");
  const query = `select Id from Customer where DisplayName = '${escaped}'`;

  const found = await quickbooksApiRequest<QboQueryResponse<{ Id: string }>>(
    connection.realmId,
    connection.accessToken,
    `query?query=${encodeURIComponent(query)}`,
  );
  const existing = (found.QueryResponse?.Customer as Array<{ Id: string }> | undefined)?.[0];
  if (existing) return existing.Id;

  const created = await quickbooksApiRequest<{ Customer: { Id: string } }>(
    connection.realmId,
    connection.accessToken,
    "customer",
    { method: "POST", body: { DisplayName: name } },
  );
  return created.Customer.Id;
}

/** A generic "Installation Service" item, created once against whatever income account the company already has. */
async function findOrCreateServiceItem(connection: QuickbooksConnection): Promise<string> {
  const found = await quickbooksApiRequest<QboQueryResponse<{ Id: string }>>(
    connection.realmId,
    connection.accessToken,
    `query?query=${encodeURIComponent("select Id from Item where Name = 'Installation Service'")}`,
  );
  const existing = (found.QueryResponse?.Item as Array<{ Id: string }> | undefined)?.[0];
  if (existing) return existing.Id;

  const accounts = await quickbooksApiRequest<QboQueryResponse<{ Id: string }>>(
    connection.realmId,
    connection.accessToken,
    `query?query=${encodeURIComponent("select Id from Account where AccountType = 'Income' maxresults 1")}`,
  );
  const incomeAccount = (accounts.QueryResponse?.Account as Array<{ Id: string }> | undefined)?.[0];
  if (!incomeAccount) {
    throw new Error("QuickBooks has no income account to attach a service item to yet.");
  }

  const created = await quickbooksApiRequest<{ Item: { Id: string } }>(
    connection.realmId,
    connection.accessToken,
    "item",
    {
      method: "POST",
      body: {
        Name: "Installation Service",
        Type: "Service",
        IncomeAccountRef: { value: incomeAccount.Id },
      },
    },
  );
  return created.Item.Id;
}

export interface QuickbooksInvoiceInput {
  customerName: string;
  billEmail: string | null;
  memo: string | null;
  description: string;
  totalCents: number;
}

export async function createQuickbooksInvoice(
  connection: QuickbooksConnection,
  input: QuickbooksInvoiceInput,
): Promise<{ id: string }> {
  const [customerId, itemId] = await Promise.all([
    findOrCreateCustomer(connection, input.customerName),
    findOrCreateServiceItem(connection),
  ]);

  const amount = Math.round(input.totalCents) / 100;

  const created = await quickbooksApiRequest<{ Invoice: { Id: string } }>(
    connection.realmId,
    connection.accessToken,
    "invoice",
    {
      method: "POST",
      body: {
        CustomerRef: { value: customerId },
        ...(input.billEmail ? { BillEmail: { Address: input.billEmail } } : {}),
        ...(input.memo ? { PrivateNote: input.memo } : {}),
        Line: [
          {
            Amount: amount,
            DetailType: "SalesItemLineDetail",
            Description: input.description,
            SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount },
          },
        ],
      },
    },
  );

  return { id: created.Invoice.Id };
}

/** Records a full payment against the invoice, which is what clears its balance in QuickBooks. */
export async function recordQuickbooksPayment(
  connection: QuickbooksConnection,
  input: { quickbooksInvoiceId: string; customerName: string; amountCents: number },
): Promise<void> {
  // A Payment requires its own CustomerRef even though it links to the
  // invoice; looked up again rather than threaded through from creation time
  // so this call has no dependency on when the invoice was created.
  const customerId = await findOrCreateCustomer(connection, input.customerName);
  const amount = Math.round(input.amountCents) / 100;

  await quickbooksApiRequest(connection.realmId, connection.accessToken, "payment", {
    method: "POST",
    body: {
      CustomerRef: { value: customerId },
      TotalAmt: amount,
      Line: [
        {
          Amount: amount,
          LinkedTxn: [{ TxnId: input.quickbooksInvoiceId, TxnType: "Invoice" }],
        },
      ],
    },
  });
}
