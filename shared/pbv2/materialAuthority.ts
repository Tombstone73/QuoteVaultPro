/**
 * A choice's material override is the single material-identity authority for
 * that choice. Its inventory-consumption entries describe quantity, basis,
 * multiplier, and waste only. Entries without an override remain independent
 * material references for secondary/recipe-style use cases.
 */

export type Pbv2MaterialAuthorityChange = {
  nodeId: string;
  choiceValue: string;
  entryIndex: number;
  fromMaterialId: string | undefined;
  toMaterialId: string;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  const sc = (globalThis as any).structuredClone as ((input: T) => T) | undefined;
  return sc ? sc(value) : JSON.parse(JSON.stringify(value)) as T;
}

export function getChoiceMaterialOverrideId(choice: unknown): string | undefined {
  if (!isRecord(choice) || !isRecord(choice.materialOverride)) return undefined;
  const materialId = choice.materialOverride.materialId;
  return typeof materialId === "string" && materialId.trim() ? materialId.trim() : undefined;
}

/** Synchronizes derived choice consumption material IDs without changing the
 * consumption parameters themselves. */
export function synchronizeChoiceInventoryConsumptionMaterial<T extends Record<string, any>>(choice: T): T {
  const materialId = getChoiceMaterialOverrideId(choice);
  const entries = Array.isArray(choice.inventoryConsumption) ? choice.inventoryConsumption : null;
  if (!materialId || !entries) return choice;

  let changed = false;
  const inventoryConsumption = entries.map((entry) => {
    if (!isRecord(entry) || entry.materialId === materialId) return entry;
    changed = true;
    return { ...entry, materialId };
  });

  return changed ? { ...choice, inventoryConsumption } : choice;
}

/**
 * Normalizes a PBV2 tree at trusted persistence/clone boundaries. It does not
 * run during validation so malformed legacy trees remain diagnosable by the
 * conflict validator.
 */
export function normalizePbv2ChoiceConsumptionMaterialAuthority<T>(treeJson: T): {
  tree: T;
  changes: Pbv2MaterialAuthorityChange[];
} {
  if (!isRecord(treeJson)) return { tree: treeJson, changes: [] };
  const tree = cloneJson(treeJson);
  const rawNodes = tree.nodes;
  const nodes = Array.isArray(rawNodes)
    ? rawNodes
    : isRecord(rawNodes)
      ? Object.values(rawNodes)
      : [];
  const changes: Pbv2MaterialAuthorityChange[] = [];

  for (const rawNode of nodes) {
    if (!isRecord(rawNode) || !Array.isArray(rawNode.choices)) continue;
    rawNode.choices = rawNode.choices.map((rawChoice: unknown) => {
      if (!isRecord(rawChoice)) return rawChoice;
      const materialId = getChoiceMaterialOverrideId(rawChoice);
      const entries = Array.isArray(rawChoice.inventoryConsumption) ? rawChoice.inventoryConsumption : null;
      if (!materialId || !entries) return rawChoice;

      const choiceValue = typeof rawChoice.value === "string" ? rawChoice.value : "(unnamed choice)";
      const nextChoice = synchronizeChoiceInventoryConsumptionMaterial(rawChoice);
      if (nextChoice === rawChoice) return rawChoice;

      entries.forEach((entry: unknown, entryIndex: number) => {
        if (!isRecord(entry) || entry.materialId === materialId) return;
        changes.push({
          nodeId: typeof rawNode.id === "string" ? rawNode.id : "(unnamed node)",
          choiceValue,
          entryIndex,
          fromMaterialId: typeof entry.materialId === "string" ? entry.materialId : undefined,
          toMaterialId: materialId,
        });
      });
      return nextChoice;
    });
  }

  return { tree, changes };
}
