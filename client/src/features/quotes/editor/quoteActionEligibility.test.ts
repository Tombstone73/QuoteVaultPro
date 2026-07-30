import { describe, expect, test } from "@jest/globals";

import { getQuotePreviewEligibility, getQuoteSendEligibility } from "./quoteActionEligibility";
import type { QuoteLineItemDraft } from "./types";

const validLineItem: QuoteLineItemDraft = {
  id: "line_1",
  productId: "product_1",
  productName: "Banner",
  variantId: null,
  variantName: null,
  productType: "wide_roll",
  width: 24,
  height: 36,
  quantity: 1,
  specsJson: {},
  selectedOptions: [],
  linePrice: 25,
  priceBreakdown: {},
  displayOrder: 0,
  status: "active",
};

describe("quote action eligibility", () => {
  test("enables Preview for a newly saved draft quote with valid line items", () => {
    expect(
      getQuotePreviewEligibility({
        quoteId: "quote_1",
        isSaving: false,
        lineItems: [validLineItem],
      }),
    ).toEqual({ enabled: true, reason: null });
  });

  test("routes Send through recipient fallback when customer email requirements are missing", () => {
    const result = getQuoteSendEligibility({
      quoteId: "quote_1",
      isSaving: false,
      lineItems: [validLineItem],
      selectedCustomer: { id: "customer_1", contacts: [{ id: "contact_1", email: "" }] } as any,
      selectedContactId: "contact_1",
      workflowState: "draft",
      requireApproval: false,
    });

    expect(result.enabled).toBe(true);
    expect(result.actionState).toBe("needs_recipient");
    expect(result.reason).toContain("recipient");
  });

  test("allows contact-only quote sending when the selected contact has email", () => {
    const result = getQuoteSendEligibility({
      quoteId: "quote_1",
      isSaving: false,
      lineItems: [validLineItem],
      selectedCustomer: null,
      selectedContactId: "contact_standalone",
      selectedContact: { id: "contact_standalone", email: "standalone@example.com" },
      workflowState: "draft",
      requireApproval: false,
    });

    expect(result.enabled).toBe(true);
    expect(result.actionState).toBe("can_send");
    expect(result.reason).toBeNull();
  });

  test("keeps Send blocked for invalid quote state instead of opening recipient fallback", () => {
    const result = getQuoteSendEligibility({
      quoteId: null,
      isSaving: false,
      lineItems: [validLineItem],
      selectedCustomer: { id: "customer_1", contacts: [] } as any,
      workflowState: "draft",
      requireApproval: false,
    });

    expect(result.enabled).toBe(false);
    expect(result.actionState).toBe("blocked");
  });

  test("Preview does not require the quote to be sent", () => {
    expect(
      getQuotePreviewEligibility({
        quoteId: "quote_1",
        isSaving: false,
        lineItems: [validLineItem],
      }).enabled,
    ).toBe(true);
  });

  test("keeps Preview disabled for unsaved and invalid quotes", () => {
    expect(
      getQuotePreviewEligibility({
        quoteId: null,
        isSaving: false,
        lineItems: [validLineItem],
      }).enabled,
    ).toBe(false);

    expect(
      getQuotePreviewEligibility({
        quoteId: "quote_1",
        isSaving: false,
        lineItems: [{ ...validLineItem, status: "draft", id: undefined }],
      }).enabled,
    ).toBe(false);
  });
});
