import { errorFinding, warningFinding, type Finding } from "../../shared/pbv2/findings";

export type Pbv2ValidationMaterialRecord = {
  id: string;
  name?: string | null;
  sku?: string | null;
  weightOzPerBasis?: string | number | null;
};

type MaterialRef = {
  materialId: string;
  path: string;
  nodeId: string;
  optionLabel: string;
  choiceLabel: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPositiveNumber(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function hasFallbackWeight(treeJson: unknown): boolean {
  const tree = asRecord(treeJson);
  const meta = asRecord(tree?.meta);
  if (!meta) return false;
  if (hasPositiveNumber(meta.baseWeightOz)) return true;
  const shippingConfig = asRecord(meta.shippingConfig);
  return hasPositiveNumber(shippingConfig?.baseWeight);
}

export function collectPbv2MaterialOverrideRefs(treeJson: unknown): MaterialRef[] {
  const tree = asRecord(treeJson);
  const nodes = asRecord(tree?.nodes);
  if (!nodes) return [];

  const refs: MaterialRef[] = [];
  for (const [nodeId, rawNode] of Object.entries(nodes)) {
    const node = asRecord(rawNode);
    if (!node) continue;
    const choices = Array.isArray(node.choices) ? node.choices : [];
    const optionLabel = isNonEmptyString(node.label) ? String(node.label) : nodeId;

    choices.forEach((rawChoice, index) => {
      const choice = asRecord(rawChoice);
      const materialOverride = asRecord(choice?.materialOverride);
      const materialId = materialOverride?.materialId;
      if (!isNonEmptyString(materialId)) return;

      const choiceValue = isNonEmptyString(choice?.value) ? String(choice.value) : `choice_${index}`;
      const choiceLabel = isNonEmptyString(choice?.label) ? String(choice.label) : choiceValue;
      refs.push({
        materialId: materialId.trim(),
        path: `tree.nodes[${nodeId}].choices[${index}].materialOverride.materialId`,
        nodeId,
        optionLabel,
        choiceLabel,
      });
    });
  }

  return refs;
}

/** Inventory-consumption references drive actual Prepress reservations. Unlike
 * display-only material overrides, a dangling value here is production-critical. */
export function collectPbv2InventoryConsumptionRefs(treeJson: unknown): MaterialRef[] {
  const tree = asRecord(treeJson);
  const nodes = asRecord(tree?.nodes);
  if (!nodes) return [];
  const refs: MaterialRef[] = [];
  for (const [nodeId, rawNode] of Object.entries(nodes)) {
    const node = asRecord(rawNode);
    if (!node) continue;
    const choices = Array.isArray(node.choices) ? node.choices : [];
    const optionLabel = isNonEmptyString(node.label) ? String(node.label) : nodeId;
    choices.forEach((rawChoice, choiceIndex) => {
      const choice = asRecord(rawChoice);
      const entries = Array.isArray(choice?.inventoryConsumption) ? choice.inventoryConsumption : [];
      const choiceValue = isNonEmptyString(choice?.value) ? String(choice.value) : `choice_${choiceIndex}`;
      const choiceLabel = isNonEmptyString(choice?.label) ? String(choice.label) : choiceValue;
      entries.forEach((rawEntry, entryIndex) => {
        const entry = asRecord(rawEntry);
        if (!isNonEmptyString(entry?.materialId)) return;
        refs.push({
          materialId: entry.materialId.trim(),
          path: `tree.nodes[${nodeId}].choices[${choiceIndex}].inventoryConsumption[${entryIndex}].materialId`,
          nodeId,
          optionLabel,
          choiceLabel,
        });
      });
    });
  }
  return refs;
}

export function collectPbv2MaterialValidationIds(input: {
  treeJson: unknown;
  productPrimaryMaterialId?: string | null;
}): string[] {
  const ids = new Set<string>();
  for (const ref of collectPbv2MaterialOverrideRefs(input.treeJson)) ids.add(ref.materialId);
  for (const ref of collectPbv2InventoryConsumptionRefs(input.treeJson)) ids.add(ref.materialId);
  if (isNonEmptyString(input.productPrimaryMaterialId)) ids.add(input.productPrimaryMaterialId.trim());
  return Array.from(ids);
}

export function validatePbv2MaterialReferences(input: {
  treeJson: unknown;
  productPrimaryMaterialId?: string | null;
  materials: Pbv2ValidationMaterialRecord[];
}): Finding[] {
  const findings: Finding[] = [];
  const materialById = new Map(input.materials.map((material) => [material.id, material]));
  const fallbackAvailable = hasFallbackWeight(input.treeJson);

  for (const ref of collectPbv2MaterialOverrideRefs(input.treeJson)) {
    const material = materialById.get(ref.materialId);
    const context = {
      materialId: ref.materialId,
      optionLabel: ref.optionLabel,
      choiceLabel: ref.choiceLabel,
    };

    if (!material) {
      findings.push(warningFinding({
        code: "PBV2_W_MATERIAL_REFERENCE_MISSING",
        message: `Material reference missing for ${ref.optionLabel}: ${ref.choiceLabel}`,
        path: ref.path,
        entityId: ref.nodeId,
        context,
      }));
      continue;
    }

    if (!hasPositiveNumber(material.weightOzPerBasis)) {
      findings.push(warningFinding({
        code: "PBV2_W_MATERIAL_WEIGHT_MISSING",
        message: `Selected material for ${ref.optionLabel}: ${ref.choiceLabel} has no configured weight`,
        path: ref.path,
        entityId: ref.nodeId,
        context: {
          ...context,
          materialName: material.name ?? null,
          materialSku: material.sku ?? null,
        },
      }));

      if (fallbackAvailable) {
        findings.push(warningFinding({
          code: "PBV2_W_PRODUCT_FALLBACK_WEIGHT_USED",
          message: `Product fallback weight will be used for ${ref.optionLabel}: ${ref.choiceLabel}`,
          path: ref.path,
          entityId: ref.nodeId,
          context,
        }));
      }
    }
  }

  for (const ref of collectPbv2InventoryConsumptionRefs(input.treeJson)) {
    if (materialById.has(ref.materialId)) continue;
    findings.push(errorFinding({
      code: "PBV2_E_INVENTORY_MATERIAL_REFERENCE_MISSING",
      message: `Production material reference missing for ${ref.optionLabel}: ${ref.choiceLabel}`,
      path: ref.path,
      entityId: ref.nodeId,
      context: { materialId: ref.materialId, optionLabel: ref.optionLabel, choiceLabel: ref.choiceLabel },
    }));
  }

  const primaryMaterialId = isNonEmptyString(input.productPrimaryMaterialId) ? input.productPrimaryMaterialId.trim() : null;
  if (primaryMaterialId) {
    const primaryMaterial = materialById.get(primaryMaterialId);
    if (!primaryMaterial) {
      findings.push(warningFinding({
        code: "PBV2_W_MATERIAL_REFERENCE_MISSING",
        message: "Product primary material reference is missing",
        path: "product.primaryMaterialId",
        context: { materialId: primaryMaterialId, role: "product_primary_material" },
      }));
    } else if (!hasPositiveNumber(primaryMaterial.weightOzPerBasis)) {
      findings.push(warningFinding({
        code: "PBV2_W_PRODUCT_PRIMARY_MATERIAL_WEIGHT_MISSING",
        message: "Product primary material has no configured weight",
        path: "product.primaryMaterialId",
        context: {
          materialId: primaryMaterialId,
          materialName: primaryMaterial.name ?? null,
          materialSku: primaryMaterial.sku ?? null,
          role: "product_primary_material",
        },
      }));
    }
  }

  return findings;
}
