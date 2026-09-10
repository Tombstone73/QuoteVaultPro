import { describe, expect, test } from "@jest/globals";

import { buildDirectOrderPayloadFromEditorState } from "./directOrderPayload";
import { cloneQuoteLineItemDraft } from "./quoteLineItemClone";
import { buildQuoteLineItemSavePayload } from "./quoteLineItemSavePayload";
import type { QuoteLineItemDraft } from "./types";

function makeLine(): QuoteLineItemDraft {
  return {
    id: "quote-line-original",
    parentLineItemId: "bundle-parent",
    lineItemRole: "child",
    productId: "product-1",
    productName: "Banner",
    variantId: "variant-1",
    variantName: "Matte",
    productType: "wide_roll",
    width: 24,
    height: 36,
    quantity: 2,
    specsJson: { notes: "Install ready", nested: { bleed: 0.25 } },
    optionSelectionsJson: { schemaVersion: 2, selected: { finish: { value: "hem" } } },
    pbv2TreeVersionId: "tree-1",
    pbv2SnapshotJson: { pricing: { totalCents: 4200 } },
    pricedAt: "2026-09-10T12:00:00.000Z",
    materialUsages: [{ materialId: "material-1", quantity: 2 }],
    selectedOptions: [{ optionId: "finish", value: "hem" }],
    linePrice: 42,
    formulaLinePrice: 40,
    priceOverride: { mode: "override_total_after_margin", valueCents: 4200 },
    overridePriceCents: 4200,
    overrideAt: "2026-09-10T12:00:00.000Z",
    overrideByUserId: "user-1",
    overrideReason: "Matched a prior quote",
    description: "Outdoor banner",
    productionNotes: "Use grommets",
    requiresDesign: true,
    requiresPrepress: true,
    requiresProofApproval: true,
    priceBreakdown: { basePrice: 40, total: 42 },
    displayOrder: 0,
    notes: "Install ready",
    productOptions: [{ id: "finish", label: "Finish" }],
    status: "active",
    pendingAttachments: [new File(["art"], "art.pdf")],
    pendingOrderAttachments: [{ uploadId: "staged-artwork", fileName: "art.pdf", mimeType: "application/pdf", sizeBytes: 3, uploadedAt: "2026-09-10T12:00:00.000Z" }],
  };
}

describe("cloneQuoteLineItemDraft", () => {
  test("creates a distinct, immediately editable quote-line identity", () => {
    const original = makeLine();
    const duplicate = cloneQuoteLineItemDraft(original, 1);

    expect(duplicate.id).toBeUndefined();
    expect(duplicate.tempId).toMatch(/^temp-/);
    expect(duplicate.tempId).not.toBe(original.id);
    expect(duplicate.parentLineItemId).toBeNull();
    expect(duplicate.lineItemRole).toBe("standalone");
    expect(duplicate.displayOrder).toBe(1);
    expect(duplicate).toMatchObject({ productId: original.productId, quantity: 2, width: 24, height: 36, description: "Outdoor banner" });
  });

  test("deep-copies editable configuration so duplicate and original cannot mutate each other", () => {
    const original = makeLine();
    const duplicate = cloneQuoteLineItemDraft(original, 1);

    (duplicate.specsJson.nested as any).bleed = 0.5;
    (duplicate.selectedOptions[0] as any).value = "grommet";
    (duplicate.optionSelectionsJson as any).selected.finish.value = "grommet";
    (duplicate.priceBreakdown as any).total = 84;
    duplicate.quantity = 4;

    expect((original.specsJson.nested as any).bleed).toBe(0.25);
    expect((original.selectedOptions[0] as any).value).toBe("hem");
    expect((original.optionSelectionsJson as any).selected.finish.value).toBe("hem");
    expect((original.priceBreakdown as any).total).toBe(42);
    expect(original.quantity).toBe(2);
  });

  test("does not copy artwork staging, relationship ids, or downstream/audit identity", () => {
    const duplicate = cloneQuoteLineItemDraft(makeLine(), 1) as any;

    expect(duplicate.pendingAttachments).toBeUndefined();
    expect(duplicate.pendingOrderAttachments).toBeUndefined();
    expect(duplicate.parentLineItemId).toBeNull();
    expect(duplicate.overrideAt).toBeNull();
    expect(duplicate.overrideByUserId).toBeNull();
    expect(duplicate).not.toHaveProperty("orderLineItemId");
    expect(duplicate).not.toHaveProperty("productionJobId");
    expect(duplicate).not.toHaveProperty("invoiceLineId");
    expect(duplicate.priceOverride).not.toHaveProperty("appliedAt");
  });

  test("creates collision-safe identities for sequential duplicates", () => {
    const original = makeLine();
    const first = cloneQuoteLineItemDraft(original, 1);
    const second = cloneQuoteLineItemDraft(original, 2);

    expect(new Set([original.id, first.tempId, second.tempId]).size).toBe(3);
  });

  test("converts an original and edited duplicate into two distinct order lines", () => {
    const original = makeLine();
    const duplicate = { ...cloneQuoteLineItemDraft(original, 1), quantity: 5, description: "Second banner" };
    const payload = buildDirectOrderPayloadFromEditorState({
      selectedCustomerId: "customer-1", selectedContactId: null, lineItems: [original, duplicate],
      subtotal: 147, effectiveTaxRate: 0, taxAmount: 0, effectiveDiscount: 0,
      jobLabel: "Two banners", orderPoNumber: "", requestedDueDate: "", orderPromisedDate: "", orderPriority: "normal", orderInternalNotes: "", deliveryMethod: "pickup", shippingCents: null, quoteNotes: "",
    });

    expect(payload.lineItems).toHaveLength(2);
    expect(payload.lineItems.map((line) => line.quantity)).toEqual([2, 5]);
    expect(payload.lineItems.map((line) => line.description)).toEqual(["Outdoor banner", "Second banner"]);
    expect(payload.lineItems[1].pendingOrderAttachmentUploadIds).toEqual([]);
  });

  test("uses the normal create payload when the independently edited duplicate is saved", () => {
    const duplicate = { ...cloneQuoteLineItemDraft(makeLine(), 1), quantity: 3, width: 30, description: "Edited copy" };
    const payload = buildQuoteLineItemSavePayload(duplicate);

    expect(payload).toMatchObject({ productId: "product-1", quantity: 3, width: 30, description: "Edited copy", productionNotes: "Use grommets", selectedOptions: [{ optionId: "finish", value: "hem" }] });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("tempId");
    expect(payload).not.toHaveProperty("parentLineItemId");
  });
});
