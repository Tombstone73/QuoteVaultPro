import { describe, expect, it } from "@jest/globals";
import {
  buildProductReplacementDraft,
  buildSavedSnapshotAfterLineItemSave,
  hasOrderLineItemDraftChanges,
  type OrderLineItemSavedSnapshot,
} from "./orderLineItemEditState";

const savedSnapshot: OrderLineItemSavedSnapshot = {
  productId: "prod-old",
  productVariantId: null,
  pbv2TreeVersionId: "tree-old",
  width: 12,
  height: 24,
  quantity: 2,
  notes: "",
  productionNotes: "",
  requiresDesign: false,
  requiresPrepress: true,
  optionSelections: {},
  optionSelectionsV2: {},
  totalPrice: 100,
};

describe("order line item edit state", () => {
  it("marks a product replacement dirty even when quantity and dimensions are unchanged", () => {
    expect(
      hasOrderLineItemDraftChanges(savedSnapshot, {
        productId: "prod-new",
        productVariantId: null,
        pbv2TreeVersionId: "tree-new",
        width: 12,
        height: 24,
        quantity: 2,
        notes: "",
        productionNotes: "",
        requiresDesign: false,
        requiresPrepress: true,
        optionSelections: {},
        optionSelectionsV2: {},
        isPbv2Mode: false,
        designBriefDraftJson: "{}",
        savedDesignBriefJson: "{}",
      }),
    ).toBe(true);
  });

  it("builds a product replacement draft that clears old PBV2 snapshot state", () => {
    const replacement = buildProductReplacementDraft({
      product: {
        id: "prod-new",
        name: "New Product",
        requiresDesign: true,
        requiresPrepress: false,
        requiresProofApproval: true,
        requiresProductionJob: true,
        pbv2ActiveTreeVersionId: null,
        requiresDimensions: false,
        pricingMode: "fee",
      },
      activeTree: null,
      orderId: "order-1",
      currentQuantity: 4,
    });

    expect(replacement.productId).toBe("prod-new");
    expect(replacement.productVariantId).toBeNull();
    expect(replacement.quantity).toBe(4);
    expect(replacement.width).toBe("0");
    expect(replacement.height).toBe("0");
    expect(replacement.optionSelections).toEqual({});
    expect(replacement.optionSelectionsV2).toEqual({ schemaVersion: 2, selected: {} });
    expect(replacement.pbv2SnapshotJson).toBeNull();
    expect(replacement.computedTotal).toBeNull();
    expect(replacement.computedTotalQty).toBeNull();
  });

  it("adopts the authoritative saved line item as the clean baseline after replacement save", () => {
    const adopted = buildSavedSnapshotAfterLineItemSave({
      savedLineItem: {
        productId: "prod-new",
        productVariantId: null,
        pbv2TreeVersionId: "tree-new",
        totalPrice: "250.50",
      },
      fallback: {
        ...savedSnapshot,
        productId: "prod-new",
        pbv2TreeVersionId: "tree-draft",
        totalPrice: 200,
      },
    });

    expect(adopted.productId).toBe("prod-new");
    expect(adopted.productVariantId).toBeNull();
    expect(adopted.pbv2TreeVersionId).toBe("tree-new");
    expect(adopted.totalPrice).toBe(250.5);

    expect(
      hasOrderLineItemDraftChanges(adopted, {
        productId: "prod-new",
        productVariantId: null,
        pbv2TreeVersionId: "tree-new",
        width: adopted.width,
        height: adopted.height,
        quantity: adopted.quantity,
        notes: adopted.notes,
        productionNotes: adopted.productionNotes,
        requiresDesign: adopted.requiresDesign,
        requiresPrepress: adopted.requiresPrepress,
        optionSelections: adopted.optionSelections,
        optionSelectionsV2: adopted.optionSelectionsV2,
        isPbv2Mode: true,
        designBriefDraftJson: "{}",
        savedDesignBriefJson: "{}",
      }),
    ).toBe(false);
  });
});
