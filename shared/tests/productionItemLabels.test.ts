import { describe, expect, test } from "@jest/globals";
import { buildProductionLabelDocument, productionLabelJobLimit, type ProductionLabelOptions, type ProductionLabelSource } from "../productionItemLabels";
import { renderProductionItemLabelsHtml } from "../productionItemLabelRendering";

const fields = { orderNumber: true, lineNumber: true, description: true, dimensions: true };
const media = { widthMm: 80, heightMm: 50 };
const source: ProductionLabelSource = {
  orderNumber: "21004",
  lines: [
    { id: "wrap", number: 1, description: "Avery 1105 Wrap Film", dimensions: "48 × 144", quantity: 4 },
    { id: "stickers", number: 2, description: "Stickers", dimensions: null, quantity: 500 },
  ],
};
const build = (options: ProductionLabelOptions) => buildProductionLabelDocument(source, options, media);
const panel = (panelCount: number, selection?: { start: number; end: number }): ProductionLabelOptions => ({
  mode: "panels", scope: "line", fields, lines: [{ lineItemId: "wrap", panelCount, selection }],
});
const batch = (total: number, perBatch: number, showRanges = false, selection?: { start: number; end: number }): ProductionLabelOptions => ({
  mode: "batches", scope: "line", fields, lines: [{ lineItemId: "stickers", total, perBatch, showRanges, selection }],
});
const numbering = (options: ProductionLabelOptions) => build(options).labels.map(label => label.rows.at(-1));

describe("production item label content", () => {
  test("plain description uses saved line number, order number, description and dimensions", () => {
    const document = build({ mode: "description", scope: "line", fields, lines: [{ lineItemId: "wrap" }] });
    expect(document.labels).toEqual([{ lineItemId: "wrap", lineNumber: 1, rows: ["Order 21004", "1. Avery 1105 Wrap Film", "48 × 144"] }]);
    expect(build({ mode: "description", scope: "line", fields: { ...fields, description: false, orderNumber: false }, lines: [{ lineItemId: "stickers" }] }).labels[0].rows)
      .toEqual(["Line 2"]);
  });

  test("missing saved descriptions stay missing; partial scope labels the subset", () => {
    const document = buildProductionLabelDocument({ ...source, lines: [{ ...source.lines[1], description: "" }] }, {
      mode: "description", scope: "partial", partialQuantity: 25, fields, lines: [{ lineItemId: "stickers" }],
    }, media);
    expect(document.labels[0].rows).toEqual(["Order 21004", "Line 2", "Quantity 25 of 500"]);
    expect(() => build({ mode: "description", scope: "partial", partialQuantity: 501, fields, lines: [{ lineItemId: "stickers" }] })).toThrow(/partial quantity/);
  });

  test("four panels, a specific reprint and a range retain the original denominator", () => {
    expect(numbering(panel(4))).toEqual(["1 of 4", "2 of 4", "3 of 4", "4 of 4"]);
    expect(numbering(panel(4, { start: 3, end: 3 }))).toEqual(["3 of 4"]);
    expect(numbering(panel(4, { start: 2, end: 3 }))).toEqual(["2 of 4", "3 of 4"]);
  });

  test.each([0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1])("rejects invalid panel count %s", count => {
    expect(() => build(panel(count))).toThrow();
  });

  test("protects job size while allowing a range from a larger panel set", () => {
    expect(() => build(panel(productionLabelJobLimit + 1))).toThrow(/Split this request/);
    expect(numbering(panel(1000, { start: 998, end: 1000 }))).toEqual(["998 of 1000", "999 of 1000", "1000 of 1000"]);
    expect(() => build(panel(4, { start: 3, end: 2 }))).toThrow(/outside/);
    expect(() => build(panel(4, { start: 4, end: 5 }))).toThrow(/outside/);
  });

  test("500/50 produces ten labels in cumulative and contiguous range formats", () => {
    expect(numbering(batch(500, 50))).toEqual(Array.from({ length: 10 }, (_, index) => (index + 1) * 50 + " of 500"));
    expect(numbering(batch(500, 50, true))).toEqual(Array.from({ length: 10 }, (_, index) => (index * 50 + 1) + "-" + (index + 1) * 50 + " of 500"));
  });

  test("525/50 preserves the partial final batch and reprints it by its original index", () => {
    expect(numbering(batch(525, 50))).toHaveLength(11);
    expect(numbering(batch(525, 50)).at(-1)).toBe("525 of 525");
    expect(numbering(batch(525, 50, true, { start: 11, end: 11 }))).toEqual(["501-525 of 525"]);
  });

  test.each([50, 60])("batch size %s covers the total once when total is 50", size => {
    expect(numbering(batch(50, size, true))).toEqual(["1-50 of 50"]);
  });

  test.each([[0, 50], [500, 0], [500, 3.5], [-5, 10]])("rejects invalid total %s or batch size %s", (total, size) => {
    expect(() => build(batch(total, size))).toThrow();
  });

  test("whole Order uses separate line identities, counts and artwork references", () => {
    const options: ProductionLabelOptions = { mode: "panels", scope: "order", fields,
      lines: [{ lineItemId: "stickers", panelCount: 1 }, { lineItemId: "wrap", panelCount: 2, artworkReference: "Driver side" }] };
    const labels = build(options).labels;
    expect(labels.map(label => [label.lineItemId, label.rows.at(-1)])).toEqual([["wrap", "1 of 2"], ["wrap", "2 of 2"], ["stickers", "1 of 1"]]);
    expect(labels[0].rows).toContain("Artwork: Driver side");
    expect(labels[2].rows).toContain("2. Stickers");
    expect(() => build({ ...options, fields: { orderNumber: true, lineNumber: false, description: false, dimensions: false },
      lines: options.lines.map(({ artworkReference, ...line }) => line) })).toThrow(/distinct information/);
    expect(() => build({ ...options, lines: [options.lines[0]] })).toThrow(/saved Order lines/);
  });

  test("whole Order quantities are independent and do not mutate the source", () => {
    const options: ProductionLabelOptions = { mode: "batches", scope: "order", fields,
      lines: [{ lineItemId: "wrap", total: 4, perBatch: 3, showRanges: true },
        { lineItemId: "stickers", total: 525, perBatch: 50, showRanges: false, selection: { start: 11, end: 11 } }] };
    expect(numbering(options)).toEqual(["1-3 of 4", "4-4 of 4", "525 of 525"]);
    expect(source.lines.map(line => line.quantity)).toEqual([4, 500]);
  });

  test("renders one plain wrapped page per label and escapes saved text", () => {
    const document = build(panel(4));
    document.labels[0].rows[1] = "Long description <script>alert(1)</script> & " + "W".repeat(300);
    const html = renderProductionItemLabelsHtml(document);
    expect(html.match(/class="production-item-label"/g)).toHaveLength(4);
    expect(html).toContain("size:80mm 50mm");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(() => renderProductionItemLabelsHtml({ ...document, media: { widthMm: 30, heightMm: 50 } })).toThrow();
  });
});
