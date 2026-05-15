type MaterialWeightDisplayInput = {
  weightValue?: string | number | null;
  weightUnit?: string | null;
  weightBasis?: string | null;
  weightOzPerBasis?: string | number | null;
};

function hasPositiveNumber(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function labelForBasis(value: string | null | undefined): string {
  switch (value) {
    case "sqft":
      return "sqft";
    case "linear_ft":
      return "linear ft";
    case "each":
    case "sheet":
    case "roll":
      return value;
    default:
      return "";
  }
}

export function formatMaterialWeightStatus(material: MaterialWeightDisplayInput | null | undefined): string {
  if (!material) return "Weight not configured";
  if (!hasPositiveNumber(material.weightValue) || !material.weightUnit || !material.weightBasis || !hasPositiveNumber(material.weightOzPerBasis)) {
    return "Weight not configured";
  }

  const basis = labelForBasis(material.weightBasis);
  if (!basis) return "Weight not configured";

  return `Weight configured: ${material.weightValue} ${material.weightUnit} / ${basis}`;
}

export function hasConfiguredMaterialWeight(material: MaterialWeightDisplayInput | null | undefined): boolean {
  return formatMaterialWeightStatus(material) !== "Weight not configured";
}
