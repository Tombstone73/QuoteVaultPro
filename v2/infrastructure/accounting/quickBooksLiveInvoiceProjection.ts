import { createHash } from "node:crypto";

/** Safe, accounting-only evidence of the facts V2 exported to QuickBooks.
 * This is integration metadata, never canonical Billing state. */
export type QuickBooksInvoiceProjectionLine = Readonly<{
  description: string;
  quantity: number;
  unitAmountCents: number;
  lineAmountCents: number;
}>;

export type QuickBooksInvoiceProjection = Readonly<{
  displayNumber: string;
  currency: string;
  postedAt: string;
  customerId: string;
  lines: readonly QuickBooksInvoiceProjectionLine[];
}>;

export const quickBooksInvoiceProjectionFingerprint = (projection: QuickBooksInvoiceProjection): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(projection)).digest("hex")}`;

export const quickBooksProjectionLines = (rows: readonly Readonly<{
  description: string;
  quantity: number;
  selling_unit_cents: string;
  selling_line_cents: string;
}>[]): QuickBooksInvoiceProjectionLine[] =>
  rows.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitAmountCents: Number(line.selling_unit_cents),
    lineAmountCents: Number(line.selling_line_cents),
  })).filter((line) => line.description.trim().length > 0
    && Number.isSafeInteger(line.quantity) && line.quantity > 0
    && Number.isSafeInteger(line.lineAmountCents));

export const storedQuickBooksProjectionLines = (projection: unknown): QuickBooksInvoiceProjectionLine[] => {
  const lines = projection && typeof projection === "object" && Array.isArray((projection as { lines?: unknown }).lines)
    ? (projection as { lines: unknown[] }).lines
    : [];
  return lines.map((line) => {
    const value = line as { description?: unknown; quantity?: unknown; unitAmountCents?: unknown; lineAmountCents?: unknown };
    return {
      description: String(value.description ?? ""),
      quantity: Number(value.quantity ?? 0),
      unitAmountCents: Number(value.unitAmountCents ?? 0),
      lineAmountCents: Number(value.lineAmountCents ?? 0),
    };
  }).filter((line) => line.description.trim().length > 0
    && Number.isSafeInteger(line.quantity) && line.quantity > 0
    && Number.isSafeInteger(line.lineAmountCents));
};
