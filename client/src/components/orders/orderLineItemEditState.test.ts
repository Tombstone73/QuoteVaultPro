import { describe, expect, it } from "@jest/globals";
import {
  buildProductReplacementDraft,
  buildSavedSnapshotAfterLineItemSave,
  hydratePersistedOrderLineItemOptionSelections,
  hydratePersistedArtworkSideIntent,
  mergeArtworkSideIntentIntoSpecs,
  hasOrderLineItemDraftChanges,
  mergeLineItemPatchSafely,
  reconcileLineItemListSafely,
  resolveLineItemDisplayPriceCents,
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
  requiresProofApproval: false,
  optionSelections: {},
  optionSelectionsV2: {},
  useSameArtworkBothSides: false,
  totalPrice: 100,
};

describe("order line item edit state", () => {
  it("hydrates persisted PBV2 selections without replacing them with product defaults", () => {
    const hydrated = hydratePersistedOrderLineItemOptionSelections({
      optionSelectionsJson: { selected: { printSides: { value: "double", label: "Double-Sided" } } },
      selectedOptions: [{ optionId: "printSides", optionName: "Print Sides", value: "double" }],
    });

    expect(hydrated.optionSelectionsV2.selected.printSides).toEqual({ value: "double", label: "Double-Sided" });
    expect(hydrated.optionSelections.printSides.value).toBe("double");

    const single = hydratePersistedOrderLineItemOptionSelections({
      optionSelectionsJson: { schemaVersion: 2, selected: { printSides: { value: "single", label: "Single-Sided" } } },
    });
    expect(single.optionSelectionsV2.selected.printSides).toEqual({ value: "single", label: "Single-Sided" });

    const snapshotOnly = hydratePersistedOrderLineItemOptionSelections({
      pbv2SnapshotJson: { selections: { printSides: { value: "double" } } },
    });
    expect(snapshotOnly.optionSelectionsV2.selected.printSides).toEqual({ value: "double" });

    const evaluatedOptionsOnly = hydratePersistedOrderLineItemOptionSelections({
      selectedOptions: [{ optionId: "printSides", optionName: "Print Sides", value: "double", selectedLabel: "Double-Sided" }],
    });
    expect(evaluatedOptionsOnly.optionSelectionsV2.selected.printSides).toEqual({ value: "double", label: "Double-Sided" });

    const mergedPersistedSources = hydratePersistedOrderLineItemOptionSelections({
      optionSelectionsJson: { schemaVersion: 2, selected: { thickness: { value: "4mm" } } },
      pbv2SnapshotJson: { selections: { printSides: { value: "double" }, thickness: { value: "10mm" } } },
    });
    expect(mergedPersistedSources.optionSelectionsV2.selected).toEqual({
      thickness: { value: "4mm" },
      printSides: { value: "double" },
    });
  });

  it("treats matching persisted V2 selections as clean and a changed side as dirty", () => {
    const persisted = hydratePersistedOrderLineItemOptionSelections({
      optionSelectionsJson: { selected: { printSides: { value: "double" } } },
    });
    const saved = { ...savedSnapshot, optionSelectionsV2: persisted.optionSelectionsV2.selected };
    const baseDraft = {
      ...saved,
      optionSelections: persisted.optionSelections,
      optionSelectionsV2: persisted.optionSelectionsV2.selected,
      isPbv2Mode: true,
      designBriefDraftJson: "{}",
      savedDesignBriefJson: "{}",
    };

    expect(hasOrderLineItemDraftChanges(saved, baseDraft)).toBe(false);
    expect(hasOrderLineItemDraftChanges(saved, {
      ...baseDraft,
      optionSelectionsV2: { printSides: { value: "single" } },
    })).toBe(true);
  });

  it("hydrates and dirty-checks the persisted same-artwork intent", () => {
    const savedSpecs = mergeArtworkSideIntentIntoSpecs(
      { notes: "Keep me", artworkSideAssignment: { frontFileId: "file-1" } },
      true,
    );
    expect(savedSpecs).toEqual({
      notes: "Keep me",
      artworkSideAssignment: { frontFileId: "file-1", useSameArtworkBothSides: true },
    });
    const persisted = hydratePersistedArtworkSideIntent({
      specsJson: savedSpecs,
    });
    expect(persisted).toEqual({ useSameArtworkBothSides: true, hasExplicitValue: true });

    const saved = { ...savedSnapshot, useSameArtworkBothSides: true };
    const draft = {
      ...saved,
      isPbv2Mode: true,
      designBriefDraftJson: "{}",
      savedDesignBriefJson: "{}",
    };
    expect(hasOrderLineItemDraftChanges(saved, draft)).toBe(false);
    expect(hasOrderLineItemDraftChanges(saved, { ...draft, useSameArtworkBothSides: false })).toBe(true);
  });
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
        requiresProofApproval: false,
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
        requiresProofApproval: adopted.requiresProofApproval,
        optionSelections: adopted.optionSelections,
        optionSelectionsV2: adopted.optionSelectionsV2,
        useSameArtworkBothSides: adopted.useSameArtworkBothSides,
        isPbv2Mode: true,
        designBriefDraftJson: "{}",
        savedDesignBriefJson: "{}",
      }),
    ).toBe(false);
  });

  it("preserves pricing/display fields when an attachment-only patch has no pricing fields", () => {
    const existing = {
      id: "li-1",
      quantity: 2,
      unitPrice: "50.00",
      totalPrice: "100.00",
      baseCalculatedTotalCents: 10000,
      effectiveTotalCents: 10000,
      hasPriceOverride: false,
      pbv2SnapshotJson: { pricing: { totalCents: 10000 } },
    };

    const merged = mergeLineItemPatchSafely(existing as any, {
      id: "li-1",
      attachments: [{ id: "file-1" }],
      updatedAt: "2026-05-31T22:00:00.000Z",
    } as any, { patchKind: "attachment" });

    expect(merged.attachments).toHaveLength(1);
    expect(merged.totalPrice).toBe("100.00");
    expect(merged.effectiveTotalCents).toBe(10000);
    expect(resolveLineItemDisplayPriceCents(merged)).toBe(10000);
  });

  it("does not let product-list reconciliation reset an existing priced row to zero", () => {
    const existingRows: any[] = [
      {
        id: "li-1",
        quantity: 2,
        totalPrice: "100.00",
        effectiveTotalCents: 10000,
        unitPrice: "50.00",
      },
    ];

    const nextRows = reconcileLineItemListSafely(existingRows, [
      { id: "li-1", quantity: 2, totalPrice: "0.00", unitPrice: "0.00" },
      { id: "li-2", quantity: 1, totalPrice: "25.00", unitPrice: "25.00" },
    ], { patchKind: "product_add", preserveLocalDrafts: false });

    expect(nextRows).toHaveLength(2);
    expect(nextRows[0].totalPrice).toBe("100.00");
    expect(resolveLineItemDisplayPriceCents(nextRows[0])).toBe(10000);
    expect(resolveLineItemDisplayPriceCents(nextRows[1])).toBe(2500);
  });

  it("allows an explicit pricing result of zero to replace a previous non-zero price", () => {
    const merged = mergeLineItemPatchSafely(
      { id: "li-1", quantity: 1, totalPrice: "100.00", effectiveTotalCents: 10000 },
      { id: "li-1", quantity: 1, totalPrice: "0.00", effectiveTotalCents: 0 } as any,
      { patchKind: "hydration" },
    );

    expect(merged.totalPrice).toBe("0.00");
    expect(resolveLineItemDisplayPriceCents(merged)).toBe(0);
  });

  it("keeps visible totals compatible through attachment, product add, override revert, and attachment removal", () => {
    let rows: any[] = [
      {
        id: "li-1",
        quantity: 3,
        unitPrice: "40.00",
        totalPrice: "120.00",
        baseCalculatedTotalCents: 12000,
        effectiveTotalCents: 12000,
        hasPriceOverride: false,
      },
    ];

    const initialTotal = resolveLineItemDisplayPriceCents(rows[0]);
    expect(initialTotal).toBe(12000);

    rows = reconcileLineItemListSafely(rows, [
      { id: "li-1", attachments: [{ id: "file-1" }], totalPrice: "0.00" } as any,
    ], { patchKind: "attachment", preserveLocalDrafts: false });
    expect(resolveLineItemDisplayPriceCents(rows[0])).toBe(initialTotal);

    rows = reconcileLineItemListSafely(rows, [
      { id: "li-1", totalPrice: "0.00" },
      { id: "li-2", quantity: 1, unitPrice: "15.00", totalPrice: "15.00" },
    ], { patchKind: "product_add", preserveLocalDrafts: false });
    expect(resolveLineItemDisplayPriceCents(rows[0])).toBe(initialTotal);

    rows = reconcileLineItemListSafely(rows, [
      {
        ...rows[0],
        hasPriceOverride: true,
        priceOverrideMode: "override_total_after_margin",
        priceOverrideValueCents: 9900,
        overridePriceCents: 9900,
        effectiveTotalCents: 9900,
        totalPrice: "99.00",
      },
      rows[1],
    ], { patchKind: "pricing", preserveLocalDrafts: false });
    expect(resolveLineItemDisplayPriceCents(rows[0])).toBe(9900);

    rows = reconcileLineItemListSafely(rows, [
      {
        ...rows[0],
        hasPriceOverride: false,
        priceOverrideMode: null,
        priceOverrideValueCents: null,
        overridePriceCents: null,
        effectiveTotalCents: 12000,
        totalPrice: "120.00",
      },
      rows[1],
    ], { patchKind: "pricing", preserveLocalDrafts: false });

    rows = reconcileLineItemListSafely(rows, [
      { id: "li-1", attachments: [], totalPrice: "0.00" } as any,
      rows[1],
    ], { patchKind: "attachment", preserveLocalDrafts: false });

    const visibleTotals = rows.map((row) => resolveLineItemDisplayPriceCents(row));
    expect(visibleTotals).toEqual([12000, 1500]);
    expect(visibleTotals.reduce((sum, cents) => sum + cents, 0)).toBe(13500);
  });
});
