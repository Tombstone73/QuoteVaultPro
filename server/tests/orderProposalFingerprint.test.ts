import { describe, expect, it } from "@jest/globals";
import { fingerprintDirectOrderProposal } from "../services/assistant/orderProposalFingerprint";

const buildInput = (overrides: Record<string, unknown> = {}) => ({
  intake: { kind: "direct", customerId: "customer_1", contactId: null, dueDate: undefined, lines: [{ productId: "product_1", quantity: 1, width: 12, height: 12, pbv2TreeVersionId: "tree_1", pbv2Selections: { schemaVersion: 2, selected: { thickness: { value: "3mm" }, sides: { value: "single" } } } }] },
  organization: { id: "org_1", defaultTaxRate: "0.0700", taxEnabled: true },
  customer: { id: "customer_1", isTaxExempt: false, taxRateOverride: null, pricingTier: "retail" },
  contact: null,
  priced: [{
    line: { productId: "product_1", quantity: 1, width: 12, height: 12, pbv2TreeVersionId: "tree_1", pbv2Selections: { schemaVersion: 2, selected: { sides: { value: "single" }, thickness: { value: "3mm" } } } },
    product: { id: "product_1", isActive: true, updatedAt: new Date("2026-07-31T10:00:00.000Z"), pbv2ActiveTreeVersionId: "tree_1", measurementMode: "area", isTaxable: true },
    treeVersionUpdatedAt: new Date("2026-07-31T10:00:00.000Z"),
    result: { pbv2TreeVersionId: "tree_1", lineTotalCents: 12500, breakdown: { baseCents: 10000, optionsCents: 2500 }, pbv2SnapshotJson: { treeVersionId: "tree_1", pricedAt: "2026-07-31T10:01:00.000Z", selections: { thickness: "3mm", sides: "single" }, selectedOptions: [{ nodeId: "thickness", choiceId: "3mm" }, { nodeId: "sides", choiceId: "single" }], visibleNodeIds: ["thickness", "sides"], pricing: { totalCents: 12500 }, pbv2PricingSnapshot: { capturedAt: "2026-07-31T10:01:00.000Z", effectiveSelections: { thickness: "3mm", sides: "single" } } } },
  }],
  totals: { subtotal: 125, taxableSubtotal: 125, taxRate: 0.07, taxAmount: 8.75, total: 133.75, lineItemsWithTax: [{ lineTotal: 125, taxAmount: 8.75, isTaxableSnapshot: true }] },
  ...overrides,
});

describe("direct order proposal fingerprint", () => {
  it("is stable across fresh PBV2 timestamps, object order, and equivalent selection order", () => {
    const first = buildInput();
    const second = buildInput();
    (second.priced[0].result.pbv2SnapshotJson as any).pricedAt = "2026-07-31T10:05:00.000Z";
    (second.priced[0].result.pbv2SnapshotJson as any).pbv2PricingSnapshot.capturedAt = "2026-07-31T10:05:00.000Z";
    (second.priced[0].result.pbv2SnapshotJson as any).selectedOptions.reverse();
    (second.priced[0].result.pbv2SnapshotJson as any).visibleNodeIds.reverse();
    (second.priced[0].result.pbv2SnapshotJson as any).selectedOptions[0].optionName = "THICKNESS";
    expect(fingerprintDirectOrderProposal(first)).toBe(fingerprintDirectOrderProposal(second));
  });

  it("normalizes omitted, undefined, and nullable optional values", () => {
    const omitted = buildInput();
    const nullable = buildInput();
    (nullable.intake as any).dueDate = null;
    (nullable.priced[0].result.pbv2SnapshotJson as any).optionalContext = null;
    expect(fingerprintDirectOrderProposal(omitted)).toBe(fingerprintDirectOrderProposal(nullable));
  });

  it("rejects authoritative price, snapshot, selection, and dimensional changes", () => {
    const base = fingerprintDirectOrderProposal(buildInput());
    const price = buildInput(); price.priced[0].result.lineTotalCents = 12600;
    const snapshot = buildInput(); snapshot.priced[0].product.pbv2ActiveTreeVersionId = "tree_2";
    const selection = buildInput(); (selection.intake as any).lines[0].pbv2Selections.selected.sides.value = "double";
    const dimensions = buildInput(); (dimensions.intake as any).lines[0].width = 24;
    expect(fingerprintDirectOrderProposal(price)).not.toBe(base);
    expect(fingerprintDirectOrderProposal(snapshot)).not.toBe(base);
    expect(fingerprintDirectOrderProposal(selection)).not.toBe(base);
    expect(fingerprintDirectOrderProposal(dimensions)).not.toBe(base);
  });

  it("binds customer pricing context and integer-cent tax totals", () => {
    const base = fingerprintDirectOrderProposal(buildInput());
    const customer = buildInput(); customer.customer.pricingTier = "wholesale";
    const cents = buildInput(); cents.totals = { ...cents.totals, total: 133.76 };
    expect(fingerprintDirectOrderProposal(customer)).not.toBe(base);
    expect(fingerprintDirectOrderProposal(cents)).not.toBe(base);
  });
});
