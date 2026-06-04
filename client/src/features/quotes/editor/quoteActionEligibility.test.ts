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

  test("keeps Send disabled when customer email requirements are missing", () => {
    const result = getQuoteSendEligibility({
      quoteId: "quote_1",
      isSaving: false,
      lineItems: [validLineItem],
      selectedCustomer: { id: "customer_1", contacts: [{ id: "contact_1", email: "" }] } as any,
      selectedContactId: "contact_1",
      workflowState: "draft",
      requireApproval: false,
    });

    expect(result.enabled).toBe(false);
    expect(result.reason).toContain("email");
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
