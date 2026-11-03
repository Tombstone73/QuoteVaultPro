type MaterialDimensions = {
  type: string; materialForm?: string | null;
  width?: string | number | null; height?: string | number | null;
  edgeWasteInPerSide?: string | number | null;
};

const positive = (value: MaterialDimensions["width"]) => value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;

/** Inventory completeness only. These dimensions do not prove machine compatibility. */
export function materialDimensionConfiguration(material: MaterialDimensions) {
  const form = material.materialForm || material.type;
  const issues: string[] = [];
  if (form === "roll" || form === "sheet") {
    if (!positive(material.width)) issues.push("Positive media width is missing");
    if (form === "sheet" && !positive(material.height)) issues.push("Positive sheet height is missing");
    if (form === "roll" && material.edgeWasteInPerSide != null) {
      const waste = Number(material.edgeWasteInPerSide);
      if (!Number.isFinite(waste) || waste < 0 || positive(material.width) && waste * 2 >= Number(material.width)) issues.push("Edge waste leaves no valid printable width");
    }
  }
  return { form, issues };
}
