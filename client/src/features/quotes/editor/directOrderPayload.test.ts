import { describe, expect, test } from "@jest/globals";

import { buildDirectOrderPayloadFromEditorState } from "./directOrderPayload";
import type { QuoteLineItemDraft } from "./types";

describe("buildDirectOrderPayloadFromEditorState", () => {
  test("builds the /orders/new direct POST payload without quote linkage", () => {
    const lineItem: QuoteLineItemDraft = {
      tempId: "temp-1",
      productId: "product-1",
      productName: "Banner",
      variantId: null,
      variantName: null,
      productType: "wide_roll",
      width: 24,
      height: 36,
      quantity: 2,
      specsJson: { notes: "Install ready" },
      optionSelectionsJson: { schemaVersion: 2, selected: { finish: "hem" } },
      pbv2TreeVersionId: "tree-1",
      pbv2SnapshotJson: { pricing: { totalCents: 4200 } },
      pricedAt: "2026-06-02T12:00:00.000Z",
      materialUsages: [],
      selectedOptions: [],
      linePrice: 42,
      formulaLinePrice: 42,
      priceOverride: null,
      overridePriceCents: null,
      overrideAt: null,
      overrideByUserId: null,
      overrideReason: null,
      description: "Outdoor banner",
      productionNotes: "Use grommets",
      requiresDesign: false,
      requiresPrepress: true,
      requiresProofApproval: true,
      priceBreakdown: { basePrice: 42, optionsPrice: 0, total: 42, formula: "fixture" },
      displayOrder: 0,
      status: "active",
      pendingOrderAttachments: [
        {
          uploadId: "upload-temp-1",
          fileName: "banner-art.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12345,
          uploadedAt: "2026-06-03T12:00:00.000Z",
        },
      ],
    };

    const payload = buildDirectOrderPayloadFromEditorState({
      selectedCustomer: undefined,
      selectedCustomerId: "customer-1",
      selectedContactId: "contact-1",
      quote: { customerId: "quote-customer-should-not-win" },
      lineItems: [
        lineItem,
        { ...lineItem, tempId: "temp-canceled", productName: "Canceled", status: "canceled" },
      ],
      subtotal: 42,
      effectiveTaxRate: 0.07,
      taxAmount: 2.94,
      effectiveDiscount: 1,
      jobLabel: "Lobby Banner",
      orderPoNumber: " PO-123 ",
      requestedDueDate: "2026-06-18",
      orderPromisedDate: "2026-06-20",
      orderPriority: "high",
      orderInternalNotes: " Rush ",
      deliveryMethod: "pickup",
      shippingCents: 500,
      quoteNotes: "Call on arrival",
      idempotencyKey: "idem-1",
    });

    expect(payload).toMatchObject({
      customerId: "customer-1",
      contactId: "contact-1",
      label: "Lobby Banner",
      poNumber: "PO-123",
      dueDate: "2026-06-18T00:00:00.000Z",
      promisedDate: "2026-06-20T00:00:00.000Z",
      priority: "high",
      notesInternal: "Rush",
      shippingMethod: "pickup",
      shippingMode: "single_shipment",
      shippingCents: 500,
      shippingInstructions: "Call on arrival",
      idempotencyKey: "idem-1",
    });
    expect(payload).not.toHaveProperty("quoteId");
    expect(payload).not.toHaveProperty("sourceQuoteId");
    expect(payload).not.toHaveProperty("sourceQuoteNumber");
    expect(payload.lineItems).toHaveLength(1);
    expect(payload.lineItems[0]).toMatchObject({
      productId: "product-1",
      description: "Outdoor banner",
      productionNotes: "Use grommets",
      requiresDesign: false,
      requiresPrepress: true,
      requiresProofApproval: true,
      optionSelectionsJson: { schemaVersion: 2, selected: { finish: "hem" } },
      pbv2SnapshotJson: { pricing: { totalCents: 4200 } },
      pendingOrderAttachmentUploadIds: ["upload-temp-1"],
    });
    expect(payload.lineItems[0]).not.toHaveProperty("quoteLineItemId");
  });

  test("omits canceled line items and keeps empty TEMP upload lists stable", () => {
    const payload = buildDirectOrderPayloadFromEditorState({
      selectedCustomer: undefined,
      selectedCustomerId: "customer-1",
      selectedContactId: null,
      lineItems: [
        {
          tempId: "temp-1",
          productId: "product-1",
          productName: "Decal",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 10,
          height: 10,
          quantity: 1,
          specsJson: {},
          selectedOptions: [],
          linePrice: 12,
          priceBreakdown: { total: 12 },
          displayOrder: 0,
          status: "active",
        } as QuoteLineItemDraft,
      ],
      subtotal: 12,
      effectiveTaxRate: 0,
      taxAmount: 0,
      effectiveDiscount: 0,
      jobLabel: "",
      orderPoNumber: "",
      requestedDueDate: "",
      orderPromisedDate: "",
      orderPriority: "",
      orderInternalNotes: "",
      deliveryMethod: "pickup",
      shippingCents: 0,
      quoteNotes: "",
    });

    expect(payload.lineItems).toHaveLength(1);
    expect(payload.lineItems[0].pendingOrderAttachmentUploadIds).toEqual([]);
  });

  test("submits contact-only identity with customerId null", () => {
    const payload = buildDirectOrderPayloadFromEditorState({
      selectedCustomer: undefined,
      selectedCustomerId: null,
      selectedContactId: "standalone-contact",
      quote: { customerId: "stale-customer" },
      lineItems: [],
      subtotal: 0,
      effectiveTaxRate: 0,
      taxAmount: 0,
      effectiveDiscount: 0,
      jobLabel: "Walk-in buyer",
      orderPoNumber: "",
      requestedDueDate: "",
      orderPromisedDate: "",
      orderPriority: "normal",
      orderInternalNotes: "",
      deliveryMethod: "pickup",
      shippingCents: null,
      quoteNotes: "",
    });

    expect(payload.customerId).toBeNull();
    expect(payload.contactId).toBe("standalone-contact");
  });
});
