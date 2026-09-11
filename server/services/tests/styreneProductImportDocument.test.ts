import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@jest/globals";
import { productImportV2RequestSchema } from "@shared/importExportSchemas";
import { resolvePortableMaterialReferences } from "../pbv2ImportMapper";

const readStyreneImport = () => JSON.parse(
  readFileSync(resolve(process.cwd(), "styrene-product-draft.json"), "utf8"),
);

describe("Styrene product import document", () => {
  test("uses the canonical import envelope rather than a raw PBV2 tree", () => {
    const document = readStyreneImport();
    const parsed = productImportV2RequestSchema.safeParse(document);

    expect(parsed.success).toBe(true);
    expect(productImportV2RequestSchema.safeParse(document.products[0].optionTreeJson).success).toBe(false);
  });

  test("carries the complete, portable Styrene configuration scaffold", () => {
    const document = readStyreneImport();
    const product = document.products[0];
    const tree = product.optionTreeJson;
    const tiers = tree.pricingMatrix.rows.flatMap((row: any) => row.qtyTiers);

    expect(product).toMatchObject({
      name: "Styrene",
      slug: "styrene",
      productTypeName: "Sheet",
      pricingEngine: "formulaLibrary",
      pricingFormulaRef: { code: "4X8_WITH_WASTE_CALCULATION" },
      isActive: false,
    });
    expect(tree.nodes.opt_styrene_thickness.choices.map((choice: any) => choice.label))
      .toEqual([".020", ".030", ".040", ".060", ".080"]);
    expect(tree.pricingMatrix.rows).toHaveLength(10);
    expect(tiers).toHaveLength(30);
    expect([...new Set(tiers.map((tier: any) => tier.minQty))].sort((a: number, b: number) => a - b))
      .toEqual([1, 10, 51]);
    expect(document.mappings.materials).toHaveLength(5);
  });

  test("resolves all Styrene tree materials by portable SKU rather than source UUID", () => {
    const document = readStyreneImport();
    const resolution = resolvePortableMaterialReferences(
      document.products[0],
      document.mappings.materials,
      new Map(document.mappings.materials.map((material: any) => [
        material.sku.toLowerCase(),
        [{ id: `target-${material.sku}`, sku: material.sku }],
      ])),
    );

    expect(resolution.issues).toEqual([]);
    expect(Object.keys(resolution.resolved.treeMaterialIdMap ?? {})).toHaveLength(5);
  });
});
