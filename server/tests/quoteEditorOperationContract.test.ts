import { describe, expect, test } from "@jest/globals";
import { changedLineData, quoteEditorRequestSchema } from "../services/assistant/quoteEditorOperationService";
import { quoteEditorInputSchema } from "../services/assistant/quoteApplicationTools";

describe("assistant Quote editor operation contract", () => {
  test("discovers independent header, update, add, and removal inputs", () => {
    const schema = quoteEditorInputSchema.properties;
    expect(schema.header.properties).toHaveProperty("customerId");
    expect(schema.header.properties).toHaveProperty("requestedDueDate");
    expect(schema.header.properties).toHaveProperty("shipToAddress1");
    expect(schema.lines.properties).toHaveProperty("update");
    expect(schema.lines.properties).toHaveProperty("create");
    expect(schema.lines.properties).toHaveProperty("delete");
    expect(schema.lines.properties.create.items.properties).toHaveProperty("manualTotalCents");
  });

  test("accepts a combined header, existing line, and new line edit without rebuilding other lines", () => {
    const request = quoteEditorRequestSchema.parse({ quoteId: "quote-1", header: { label: "PO 152878", requestedDueDate: "2026-10-27T00:00:00.000Z" },
      lines: { update: [{ id: "existing-1", changes: { quantity: 10 } }], create: [{ productId: "product-2", width: 24, height: 18, quantity: 1 }] } });
    expect(request.lines.delete).toEqual([]);
    expect(request.lines.update).toHaveLength(1);
    expect(request.lines.create).toHaveLength(1);
  });

  test("rejects unreviewed price overrides, unsupported fields, and ambiguous clear plus set", () => {
    const base = { quoteId: "quote-1", lines: { update: [{ id: "line-1", changes: { manualTotalCents: 1200 } }] } };
    expect(quoteEditorRequestSchema.safeParse(base).success).toBe(false);
    expect(quoteEditorRequestSchema.safeParse({ ...base, lines: { update: [{ id: "line-1", changes: { manualTotalCents: 1200, manualPriceReason: "Staff approved", clearManualPrice: true } }] } }).success).toBe(false);
    expect(quoteEditorRequestSchema.safeParse({ quoteId: "quote-1", header: { status: "accepted" } }).success).toBe(false);
  });

  test("keeps persisted options, notes, and explicit staff price when changing quantity", () => {
    const previous = { productId: "p1", productName: "Board", variantId: "v1", productType: "wide_flatbed", width: "12", height: "12", quantity: 1,
      optionSelectionsJson: { selected: { thickness: "10mm" } }, specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 125 }, finish: "cut" },
      linePrice: "1.25", overridePriceCents: 125, overrideReason: "Staff approved", description: "Keep this", productionNotes: "Pack flat", status: "active" };
    const changed = changedLineData(previous, { quantity: 10 });
    expect(changed).toMatchObject({ quantity: 10, width: 12, height: 12, optionSelectionsJson: previous.optionSelectionsJson,
      specsJson: previous.specsJson, priceOverride: previous.specsJson.priceOverride, overrideReason: "Staff approved",
      description: "Keep this", productionNotes: "Pack flat" });
  });
});
