import type { Finding } from "./findings";

export type Pbv2FindingPresentation = {
  title: string;
  message: string;
};

type MaterialNameResolver = (materialId: string) => string | undefined;

function readText(context: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = context?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTextList(context: Record<string, unknown> | undefined, key: string): string[] {
  const value = context?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function displayMaterial(materialId: string, resolveMaterialName?: MaterialNameResolver): string {
  return resolveMaterialName?.(materialId) ?? materialId;
}

/**
 * Keeps the editor's primary validation copy operational. Diagnostic codes remain
 * available in the UI's details disclosure instead of being the first thing an
 * operator has to interpret.
 */
export function presentPbv2FindingForOperator(
  finding: Finding,
  resolveMaterialName?: MaterialNameResolver,
): Pbv2FindingPresentation {
  if (finding.code === "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT") {
    const group = readText(finding.context, "optionGroupLabel") ?? "This option";
    const choice = readText(finding.context, "choiceLabel") ?? "selected choice";
    const overrideId = readText(finding.context, "materialOverrideId");
    const inventoryIds = readTextList(finding.context, "conflictingInventoryMaterialIds");
    const selectedMaterial = overrideId ? displayMaterial(overrideId, resolveMaterialName) : "the selected material";
    const inventoryMaterials = inventoryIds.length > 0
      ? inventoryIds.map((materialId) => displayMaterial(materialId, resolveMaterialName)).join(", ")
      : "a different material";

    return {
      title: "Material configuration conflict",
      message: `${group} — ${choice} selects ${selectedMaterial}, but its inventory consumption uses ${inventoryMaterials}. Choose the selected material for inventory consumption; the consumption rule defines the quantity and basis.`,
    };
  }

  if (finding.code === "PBV2_W_WEIGHT_MISSING") {
    return {
      title: "Shipping weight not configured",
      message: "No shipping weight is configured. Calculated shipping weight will be 0 until a base or option weight is added.",
    };
  }

  return {
    title: finding.severity === "WARNING" ? "Validation warning" : "Validation issue",
    message: finding.message,
  };
}
