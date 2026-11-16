import type { Material, MaterialFamily } from "@/hooks/useMaterials";

export type MaterialInventoryGroup =
  | { kind: "family"; family: MaterialFamily; variants: Material[] }
  | { kind: "material"; material: Material };

export function getVariantLabel(material: Material, family: MaterialFamily): string {
  const values = new Map((material.variantValues ?? []).map(({ dimensionId, value }) => [dimensionId, value.trim()]));
  const orderedValues = family.dimensions
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map(({ id }) => values.get(id));
  return orderedValues.length > 0 && orderedValues.every(Boolean) ? orderedValues.join(" · ") : material.name;
}

export function buildMaterialInventoryGroups(
  sortedMaterials: Material[],
  families: MaterialFamily[],
  filtered: boolean,
  nameSortDirection?: "asc" | "desc",
): MaterialInventoryGroup[] {
  const familiesById = new Map(families.map((family) => [family.id, family]));
  const groups: MaterialInventoryGroup[] = [];
  const familyGroups = new Map<string, Extract<MaterialInventoryGroup, { kind: "family" }>>();

  for (const material of sortedMaterials) {
    const family = material.materialFamilyId ? familiesById.get(material.materialFamilyId) : undefined;
    if (!family) {
      groups.push({ kind: "material", material });
      continue;
    }
    let group = familyGroups.get(family.id);
    if (!group) {
      group = { kind: "family", family, variants: [] };
      familyGroups.set(family.id, group);
      groups.push(group);
    }
    group.variants.push(material);
  }

  if (!filtered) {
    for (const family of families) {
      if (!familyGroups.has(family.id) && family.isActive) {
        groups.push({ kind: "family", family, variants: [] });
      }
    }
  }

  if (nameSortDirection) {
    const multiplier = nameSortDirection === "asc" ? 1 : -1;
    groups.sort((left, right) => {
      const leftName = left.kind === "family" ? left.family.name : left.material.name;
      const rightName = right.kind === "family" ? right.family.name : right.material.name;
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base" }) * multiplier;
    });
  }
  return groups;
}
