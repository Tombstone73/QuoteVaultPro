/** Only explicit staff intent can change a persisted PO proposal. File text is never authorization. */
export function purchaseOrderCorrection(message: string) {
  const product = message.match(/\bproduct\s+should\s+be\s+(.+?)(?=\s+(?:and\s+)?(?:\d+\.\s*)?use\s+(?:the\s+)?PO\s+pric|[\n;]|$)/i)
    ?? message.match(/\buse\s+(?:the\s+)?product\s+["“‘']([^"”’'\n]+)["”’']/i)
    ?? message.match(/\buse\s+(?:the\s+)?product\s+(.+?)(?=\s+(?:and\s+)?(?:\d+\.\s*)?use\s+(?:the\s+)?PO\s+pric|[\n;]|$)/i);
  const productName = product?.[1]?.trim().replace(/^["“‘']|["”’'.]+$/g, "").trim() || null;
  const usePoPricing = /\buse\s+(?:the\s+)?(?:PO|purchase\s+order)\s+pric(?:e|es|ing)\b/i.test(message);
  return { productName, usePoPricing, explicit: Boolean(productName || usePoPricing) };
}

export type PurchaseOrderRequestedLine = {
  productName: string; quantity: number; width: number; height: number; options: string;
  versionCount?: number | null;
};
export type PurchaseOrderPrice = { basis: "unit" | "line_total" | "order_total"; amountCents: number };

/** Order totals need allocation/tax/shipping review; never silently divide them across lines. */
export function purchaseOrderLineTotal(price: PurchaseOrderPrice | null | undefined, quantity: number): number | null {
  if (!price || price.basis === "order_total" || !Number.isSafeInteger(price.amountCents) || price.amountCents < 0) return null;
  const total = price.basis === "unit" ? price.amountCents * quantity : price.amountCents;
  return Number.isSafeInteger(total) ? total : null;
}
