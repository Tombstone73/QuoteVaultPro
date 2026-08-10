import { matrixReplacementFromTable } from "../services/assistant/inactivePbv2PricingMatrixTableParser";

const tree = {
  nodes: {
    material: { label: "Material", input: { selectionKey: "material" }, choices: [{ value: "4mm", label: "4mm" }, { value: "10mm", label: "10mm" }] },
    sides: { label: "Printed Sides", input: { selectionKey: "printed_sides" }, choices: [{ value: "single", label: "Single-Sided" }, { value: "double", label: "Double-Sided" }] },
  },
  pricingMatrix: {
    dimensions: ["material", "printed_sides"],
    rows: [
      { id: "4-single", when: { material: "4mm", printed_sides: "single" }, variables: { base_price: 100 } },
      { id: "4-double", when: { material: "4mm", printed_sides: "double" }, variables: { base_price: 200 } },
      { id: "10-single", when: { material: "10mm", printed_sides: "single" }, variables: { base_price: 300 } },
      { id: "10-double", when: { material: "10mm", printed_sides: "double" }, variables: { base_price: 400 } },
    ],
  },
};

const markdown = `Update the inactive Coroplast Signs matrix:

| Material | Single-Sided | Double-Sided |
| --- | ---: | ---: |
| 4mm | 12.00 | 16.00 |
| 10mm | 18.00 | 24.00 |`;
const csv = `Replace the inactive Coroplast Signs matrix:

Material,"Single-Sided","Double-Sided"
"4mm","12.00","16.00"
"10mm","18.00","24.00"`;

describe("inactive PBV2 pricing-matrix table parser", () => {
  it("normalizes Markdown and quoted CSV through the shared configurable-product parser", () => {
    const fromMarkdown = matrixReplacementFromTable(markdown, tree);
    const fromCsv = matrixReplacementFromTable(csv, tree);
    expect(fromMarkdown).toEqual(fromCsv);
    expect(fromMarkdown.rows.map((row: any) => row.variables.base_price)).toEqual([1200, 1600, 1800, 2400]);
    expect(fromMarkdown.rows[0]).toMatchObject({ id: "4-single", when: { material: "4mm", printed_sides: "single" } });
  });

  it.each([
    ["a missing cell", `Material,Single-Sided,Double-Sided\n4mm,12,\n10mm,18,24`, /Invalid non-negative currency value/],
    ["a duplicate row", `Material,Single-Sided,Double-Sided\n4mm,12,16\n4MM,18,24`, /Duplicate matrix row value/],
    ["a duplicate column", `Material,Single-Sided,single-sided\n4mm,12,16\n10mm,18,24`, /Matrix columns must be unique/],
    ["an inconsistent row", `Material,Single-Sided,Double-Sided\n4mm,12\n10mm,18,24`, /Every matrix row/],
    ["a non-numeric price", `Material,Single-Sided,Double-Sided\n4mm,free,16\n10mm,18,24`, /Invalid non-negative currency value/],
  ])("rejects %s before a proposal can be prepared", (_label, input, expected) => {
    expect(() => matrixReplacementFromTable(input, tree)).toThrow(expected);
  });

  it("does not guess a header that is not a bound PBV2 dimension", () => {
    expect(() => matrixReplacementFromTable(`Thickness,Single-Sided,Double-Sided\n4mm,12,16\n10mm,18,24`, tree)).toThrow(/does not identify a bound PBV2 matrix dimension/);
  });
});
