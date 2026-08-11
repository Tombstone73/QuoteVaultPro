import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import {
  insertMaterialSchema,
  materialProductLinks,
  materials,
  products,
  vendors,
  type Material,
} from "@shared/schema";

export type DuplicateMaterialResult = {
  material: Material & { linkedProductIds: string[] };
  copiedProductLinkIds: string[];
};

export type DuplicateMaterialIdentity = {
  name: string;
  sku: string;
};

export class DuplicateMaterialError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: "MATERIAL_NOT_FOUND" | "MATERIAL_NOT_DUPLICABLE",
    message: string,
  ) {
    super(message);
    this.name = "DuplicateMaterialError";
  }
}

function normalizeIdentity(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function nextUniqueValue(existingValues: Iterable<string>, format: (ordinal: number | null) => string) {
  const existing = new Set(Array.from(existingValues, normalizeIdentity).filter(Boolean));
  const first = format(null);
  if (!existing.has(normalizeIdentity(first))) return first;

  for (let ordinal = 2; ordinal < 1000; ordinal += 1) {
    const candidate = format(ordinal);
    if (!existing.has(normalizeIdentity(candidate))) return candidate;
  }

  return format(Date.now());
}

export function buildDuplicateMaterialIdentity(source: {
  name: string;
  sku: string;
}, existingMaterials: Array<{ name?: string | null; sku?: string | null }>): DuplicateMaterialIdentity {
  const sourceName = String(source.name || "").trim();
  const sourceSku = String(source.sku || "").trim();

  return {
    name: nextUniqueValue(existingMaterials.map((material) => material.name || ""), (ordinal) =>
      ordinal == null ? `${sourceName} (Copy)` : `${sourceName} (Copy ${ordinal})`,
    ),
    sku: nextUniqueValue(existingMaterials.map((material) => material.sku || ""), (ordinal) =>
      ordinal == null ? `${sourceSku}-COPY` : `${sourceSku}-COPY-${ordinal}`,
    ),
  };
}

export function buildDuplicateMaterialPayload(source: Material, identity: DuplicateMaterialIdentity, options?: {
  preferredVendorId?: string | null;
  linkedProductIds?: string[];
}) {
  const materialForm = source.materialForm || source.type;
  if (!materialForm) {
    throw new DuplicateMaterialError(422, "MATERIAL_NOT_DUPLICABLE", "Material must have a configured material form before it can be duplicated.");
  }

  return insertMaterialSchema.parse({
    name: identity.name,
    sku: identity.sku,
    type: materialForm,
    materialForm,
    category: source.category ?? undefined,
    inventoryUnit: source.inventoryUnit,
    vendorCostUnit: source.vendorCostUnit ?? undefined,
    consumptionUnit: source.consumptionUnit,
    weightValue: source.weightValue ?? undefined,
    weightUnit: source.weightUnit ?? undefined,
    weightBasis: source.weightBasis ?? undefined,
    weightOzPerBasis: source.weightOzPerBasis ?? undefined,
    costPerUnit: source.costPerUnit,
    stockQuantity: 0,
    minStockAlert: source.minStockAlert,
    isActive: true,
    width: source.width ?? undefined,
    height: source.height ?? undefined,
    thickness: source.thickness ?? undefined,
    thicknessUnit: source.thicknessUnit ?? undefined,
    color: source.color ?? undefined,
    specsJson: source.specsJson ?? undefined,
    preferredVendorId: options?.preferredVendorId ?? null,
    preferredVendorName: source.preferredVendorName ?? undefined,
    vendorSku: source.vendorSku ?? undefined,
    vendorCostPerUnit: source.vendorCostPerUnit ?? undefined,
    vendorProductUrl: source.vendorProductUrl ?? undefined,
    vendorNotes: source.vendorNotes ?? undefined,
    vendorLastPriceCents: source.vendorLastPriceCents ?? null,
    vendorLastPriceUpdatedAt: source.vendorLastPriceUpdatedAt ?? null,
    rollLengthFt: source.rollLengthFt ?? undefined,
    costPerRoll: source.costPerRoll ?? undefined,
    edgeWasteInPerSide: source.edgeWasteInPerSide ?? undefined,
    leadWasteFt: source.leadWasteFt ?? undefined,
    tailWasteFt: source.tailWasteFt ?? undefined,
    aiParsingDescription: source.aiParsingDescription ?? undefined,
    aiParsingDescriptionLinkedToDescription: Boolean(source.aiParsingDescriptionLinkedToDescription),
    linkedProductIds: options?.linkedProductIds ?? [],
  });
}

export async function duplicateMaterial(input: {
  organizationId: string;
  materialId: string;
}): Promise<DuplicateMaterialResult> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(materials)
      .where(and(eq(materials.organizationId, input.organizationId), eq(materials.id, input.materialId)))
      .limit(1);

    if (!source) {
      throw new DuplicateMaterialError(404, "MATERIAL_NOT_FOUND", "Material not found");
    }

    const existingMaterials = await tx
      .select({ name: materials.name, sku: materials.sku })
      .from(materials)
      .where(eq(materials.organizationId, input.organizationId));

    const activeProductLinks = await tx
      .select({ productId: materialProductLinks.productId })
      .from(materialProductLinks)
      .innerJoin(products, and(
        eq(products.id, materialProductLinks.productId),
        eq(products.organizationId, input.organizationId),
        eq(products.isActive, true),
      ))
      .where(and(
        eq(materialProductLinks.organizationId, input.organizationId),
        eq(materialProductLinks.materialId, input.materialId),
        isNull(materialProductLinks.removedAt),
      ));

    const preferredVendorRows = source.preferredVendorId
      ? await tx
          .select({ id: vendors.id })
          .from(vendors)
          .where(and(eq(vendors.organizationId, input.organizationId), eq(vendors.id, source.preferredVendorId)))
          .limit(1)
      : [];

    const linkedProductIds = Array.from(new Set(activeProductLinks.map((link) => String(link.productId)).filter(Boolean)));
    const identity = buildDuplicateMaterialIdentity(source, existingMaterials);
    const parsed = buildDuplicateMaterialPayload(source, identity, {
      preferredVendorId: preferredVendorRows[0]?.id ?? null,
      linkedProductIds,
    });
    const { linkedProductIds: _linkedProductIds, ...materialFields } = parsed as typeof parsed & { linkedProductIds?: string[] };

    const [created] = await tx
      .insert(materials)
      .values({
        ...materialFields,
        type: materialFields.materialForm,
        organizationId: input.organizationId,
      } as any)
      .returning();

    if (linkedProductIds.length > 0) {
      await tx.insert(materialProductLinks).values(linkedProductIds.map((productId) => ({
        organizationId: input.organizationId,
        materialId: created.id,
        productId,
      })));
    }

    return {
      material: { ...created, linkedProductIds },
      copiedProductLinkIds: linkedProductIds,
    };
  });
}
