import { describe, expect, test } from "@jest/globals";
import type { Material, MaterialFamily } from "@/hooks/useMaterials";
import { buildMaterialInventoryGroups, getVariantLabel } from "./materialInventoryGroups";

const material = (id: string, familyId: string | null = null): Material => ({
  id, name: id, sku: `SKU-${id}`, type: "ink", inventoryUnit: "ml", costPerUnit: "12", stockQuantity: "5",
  minStockAlert: "2", isActive: true, materialFamilyId: familyId,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const family = (id: string, variants: Material[]): MaterialFamily => ({
  id, name: id, isActive: true, dimensions: [{ id: "color", key: "color", displayName: "Color", sortOrder: 0 }], variants,
});

describe("Materials inventory groups", () => {
  test("keeps concrete variants together and standalone Materials independent", () => {
    const cyan = material("Cyan", "Canon M5 Ink");
    const magenta = material("Magenta", "Canon M5 Ink");
    const yellow = material("Yellow", "Other Ink");
    const standalone = material("Standalone");
    const groups = buildMaterialInventoryGroups(
      [cyan, standalone, yellow, magenta],
      [family("Canon M5 Ink", [cyan, magenta]), family("Other Ink", [yellow])],
      false,
    );

    expect(groups.map((group) => group.kind === "family" ? group.family.id : group.material.id)).toEqual(["Canon M5 Ink", "Standalone", "Other Ink"]);
    expect(groups[0]).toMatchObject({ kind: "family", variants: [{ id: "Cyan" }, { id: "Magenta" }] });
    expect(groups[1]).toMatchObject({ kind: "material", material: { id: "Standalone" } });
    expect(cyan).toMatchObject({ id: "Cyan", sku: "SKU-Cyan", stockQuantity: "5", costPerUnit: "12" });
  });

  test("keeps only matching variants in a filtered family and sorts parents by family name", () => {
    const cyan = material("Cyan", "Canon M5 Ink");
    const magenta = material("Magenta", "Canon M5 Ink");
    const groups = buildMaterialInventoryGroups([cyan, material("Acrylic")], [family("Canon M5 Ink", [cyan, magenta])], true, "asc");
    expect(groups.map((group) => group.kind === "family" ? group.family.name : group.material.name)).toEqual(["Acrylic", "Canon M5 Ink"]);
    expect(groups[1]).toMatchObject({ kind: "family", variants: [{ id: "Cyan" }] });
  });

  test("uses dimension values for short labels and the stored name when a value is missing", () => {
    const cyan = { ...material("Canon M5 Ink - Cyan", "family"), variantValues: [{ dimensionId: "color", value: "Cyan" }] };
    const inkFamily = family("family", [cyan]);
    expect(getVariantLabel(cyan, inkFamily)).toBe("Cyan");
    expect(getVariantLabel(material("Canon M5 Ink - Magenta", "family"), inkFamily)).toBe("Canon M5 Ink - Magenta");
    expect(getVariantLabel(cyan, { ...inkFamily, dimensions: [...inkFamily.dimensions, { id: "size", key: "size", displayName: "Size", sortOrder: 1 }] })).toBe(cyan.name);
  });
});
