export type MaterialFamilyDimensionInput = { id: string; displayName: string };

export function materialFamilyAssignmentPayload(familyId: string, dimensions: readonly MaterialFamilyDimensionInput[], values: Readonly<Record<string, string>>) {
  const normalizedFamilyId = familyId.trim();
  if (!normalizedFamilyId) throw new Error("Select a Material Family.");
  return { familyId: normalizedFamilyId, values: dimensions.map((dimension) => {
    const value = String(values[dimension.id] ?? "").trim();
    if (!value) throw new Error(`${dimension.displayName} is required.`);
    return { dimensionId: dimension.id, value };
  }) };
}

export function materialFamilyActionLabel(materialFamilyId: string | null | undefined) { return materialFamilyId ? "Change Family" : "Assign Family"; }
