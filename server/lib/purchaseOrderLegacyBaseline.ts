import { z } from "zod";
import type { AuditLog, PurchaseOrderSnapshot } from "@shared/schema";
import { decimalInput, purchaseTotals, scaledDecimal } from "@shared/purchaseOrderWorkflow";

const nullableText = z.string().nullish().transform(value => value ?? null);
const issuedHeader = z.object({
  id: z.string(), organizationId: z.string(), status: z.literal("issued"), grandTotal: decimalInput(10, 2),
});
const issuedDraft = z.object({
  id: z.string(), organizationId: z.string(), status: z.literal("draft"), poNumber: z.string(),
  issueDate: z.string().datetime(), expectedDate: z.string().datetime().nullish(),
  subtotal: decimalInput(10, 2), taxTotal: decimalInput(10, 2), shippingTotal: decimalInput(10, 2), grandTotal: decimalInput(10, 2),
  notes: nullableText, paymentTerms: nullableText, paymentMethod: nullableText, paymentInstructions: nullableText,
  vendor: z.object({ name: z.string(), email: nullableText, phone: nullableText }).nullish(),
  relatedOrder: z.object({ orderNumber: nullableText, displayNumber: nullableText }).nullish(),
  lineItems: z.array(z.object({
    id: z.string(), description: z.string(), vendorSku: nullableText, quantityOrdered: decimalInput(10, 2),
    unitCost: decimalInput(10, 4), lineTotal: decimalInput(10, 4),
  })).min(1),
});

export function recoverPurchaseOrderIssuance(events: AuditLog[], organizationId: string, id: string) {
  const issues = events.filter(event => event.actionType === "ISSUE" && event.organizationId === organizationId &&
    event.entityType === "purchase_order" && event.entityId === id);
  // Multiple issue events from the legacy endpoint cannot establish a unique baseline.
  if (issues.length !== 1) return null;
  const event = issues[0];
  const before = issuedDraft.safeParse(event.oldValues);
  const after = issuedHeader.safeParse(event.newValues);
  if (!before.success || !after.success) return null;
  const draft = before.data;
  if (draft.id !== id || after.data.id !== id || draft.organizationId !== organizationId || after.data.organizationId !== organizationId) return null;
  const totals = purchaseTotals(draft.lineItems, draft.taxTotal, draft.shippingTotal);
  if (scaledDecimal(totals.subtotal, 2) !== scaledDecimal(draft.subtotal, 2) ||
      scaledDecimal(totals.grandTotal, 2) !== scaledDecimal(draft.grandTotal, 2) ||
      scaledDecimal(totals.grandTotal, 2) !== scaledDecimal(after.data.grandTotal, 2)) return null;
  const snapshot: PurchaseOrderSnapshot = {
    poNumber: draft.poNumber, issueDate: draft.issueDate, expectedDate: draft.expectedDate ?? null,
    subtotal: draft.subtotal, taxTotal: draft.taxTotal, shippingTotal: draft.shippingTotal, grandTotal: draft.grandTotal,
    paymentTerms: draft.paymentTerms, paymentMethod: draft.paymentMethod, paymentInstructions: draft.paymentInstructions, notes: draft.notes,
    vendor: draft.vendor ?? null, shipTo: null,
    orderNumber: draft.relatedOrder?.displayNumber ?? draft.relatedOrder?.orderNumber ?? null, lines: draft.lineItems,
  };
  return { snapshot, event };
}
