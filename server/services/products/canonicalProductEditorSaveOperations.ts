import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogs, materials, pbv2TreeVersions, pricingFormulas, products, productTypes,
  updateProductSchema, type UpdateProduct,
} from "@shared/schema";
import type { db as ProductDatabase } from "../../db";
import { applyProductTypeIdUpdateGuard } from "../../lib/productUpdateGuards";
import { normalizeProductRotationForWrite } from "../../lib/productPricingRotationWrite";
import { collectPbv2MaterialValidationIds } from "../pbv2MaterialValidation";
import { normalizePbv2ChoiceConsumptionMaterialAuthority } from "@shared/pbv2/materialAuthority";
import { normalizeCanonicalProductPricingTree, productPricingMetadataChangesSchema } from "./canonicalProductPricingOperations";
import { productConfigurationChangesSchema } from "./canonicalProductConfigurationOperations";
import { validateCanonicalPbv2OptionConfigurationTree } from "./canonicalPbv2OptionConfigurationOperations";
import { validateCanonicalProductPublishTarget } from "./canonicalProductPublishOperations";

const saveRequestSchema = z.object({
  expectedProductUpdatedAt: z.string().datetime(),
  expectedActiveTreeVersionId: z.string().min(1),
  product: updateProductSchema,
  treeJson: z.record(z.any()),
  confirmWarnings: z.boolean().optional(),
}).strict();

export class CanonicalProductEditorSaveError extends Error {
  constructor(
    readonly code: "PRODUCT_NOT_FOUND" | "PRODUCT_SAVE_STALE" | "PRODUCT_SAVE_INVALID" | "PRODUCT_SAVE_REPAIR_REQUIRED" | "PRODUCT_SAVE_WARNINGS_CONFIRM_REQUIRED",
    message: string,
    readonly findings: readonly unknown[] = [],
  ) {
    super(message);
    this.name = "CanonicalProductEditorSaveError";
  }
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

const forbiddenProductFields = new Set([
  "id", "organizationId", "createdAt", "updatedAt", "pbv2ActiveTreeVersionId",
  "optionTreeJson", "optionsJson", "priceBreaks", "thumbnailUrls",
]);

/** The normal editor's live save is one Product/PBV2 business operation.
 * Explicit DRAFT and Product Intake flows continue to use their own routes. */
export async function saveActiveProductEditorConfiguration(input: {
  organizationId: string;
  productId: string;
  actorUserId: string;
  request: unknown;
  database?: typeof ProductDatabase;
  auditContext?: { source: "assistant_go"; reference: string; before: Record<string, unknown>; after: Record<string, unknown> };
}) {
  const request = saveRequestSchema.parse(input.request);
  const rawProduct = (input.request as { product?: Record<string, unknown> }).product ?? {};
  const forbidden = Object.keys(rawProduct).filter((key) => forbiddenProductFields.has(key));
  if (forbidden.length) throw new CanonicalProductEditorSaveError(
    "PRODUCT_SAVE_INVALID", `Normal Save cannot write separately owned fields: ${forbidden.join(", ")}.`,
  );
  const database = input.database ?? (await import("../../db")).db;
  return database.transaction(async (tx) => {
    const [current] = await tx.select().from(products).where(and(
      eq(products.organizationId, input.organizationId), eq(products.id, input.productId),
    )).limit(1);
    if (!current) throw new CanonicalProductEditorSaveError("PRODUCT_NOT_FOUND", "Product not found.");
    if (!current.isActive || !current.pbv2ActiveTreeVersionId) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_INVALID", "This Product has no live PBV2 configuration. Use its explicit DRAFT workflow.",
    );
    if (current.updatedAt.toISOString() !== request.expectedProductUpdatedAt ||
        current.pbv2ActiveTreeVersionId !== request.expectedActiveTreeVersionId) {
      throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_STALE", "The live Product changed. Reload before saving.");
    }
    const [active] = await tx.select().from(pbv2TreeVersions).where(and(
      eq(pbv2TreeVersions.organizationId, input.organizationId),
      eq(pbv2TreeVersions.productId, input.productId),
      eq(pbv2TreeVersions.id, current.pbv2ActiveTreeVersionId),
      eq(pbv2TreeVersions.status, "ACTIVE"),
    )).limit(1);
    if (!active) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_STALE", "The live PBV2 version changed. Reload before saving.");

    const prepared: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(request.product)) {
      prepared[key] = value === "" && key !== "name" && key !== "description" ? null : value;
    }
    if ("variantLabel" in prepared && prepared.variantLabel === null) prepared.variantLabel = "Variant";
    const [knownTypes] = await Promise.all([
      tx.select({ id: productTypes.id }).from(productTypes).where(eq(productTypes.organizationId, input.organizationId)),
    ]);
    const typeGuard = applyProductTypeIdUpdateGuard({
      productData: prepared,
      existingProductTypeId: current.productTypeId,
      knownProductTypeIds: knownTypes.map((row) => row.id),
    });
    if (!typeGuard.ok) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_INVALID", typeGuard.message);
    if (typeGuard.warning) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_INVALID", "Select a Product type before saving.");
    const metadata = normalizeProductRotationForWrite(typeGuard.productData, current) as UpdateProduct;
    const proposed = { ...current, ...metadata };
    updateProductSchema.parse(proposed);
    const configuration = Object.fromEntries(
      ["name", "description", "category", "productTypeId", "measurementMode", "workflowIntent", "requiresProductionJob", "requiresProofApproval"]
        .filter((key) => key in metadata).map((key) => [key, (metadata as Record<string, unknown>)[key]]),
    );
    if (Object.keys(configuration).length) productConfigurationChangesSchema.parse(configuration);
    const pricingMetadata = Object.fromEntries(
      ["pricingMode", "pricingFormula", "pricingProfileKey", "pricingProfileConfig", "pricingEngine", "pricingFormulaId", "minPricePerItem", "allowZeroPrice"]
        .filter((key) => key in metadata).map((key) => [key, (metadata as Record<string, unknown>)[key]]),
    );
    if (Object.keys(pricingMetadata).length) productPricingMetadataChangesSchema.parse(pricingMetadata);

    if (proposed.workflowIntent === "service_fee" &&
        (proposed.measurementMode !== "quantity_only" || proposed.requiresProductionJob !== false ||
         proposed.requiresProofApproval !== false)) {
      throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_INVALID", "Service/Fee Products require quantity-only measurement and no production or proof workflow.");
    }
    const proposedMaterialId = metadata.primaryMaterialId === undefined ? current.primaryMaterialId : metadata.primaryMaterialId;
    if (proposedMaterialId) {
      const [primaryMaterial] = await tx.select({ id: materials.id, isActive: materials.isActive })
        .from(materials).where(and(eq(materials.organizationId, input.organizationId), eq(materials.id, proposedMaterialId))).limit(1);
      if (!primaryMaterial?.isActive) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_INVALID", "Select an active Material in this organization.");
    }

    // Only status changes automatically. A sanitizer or compatibility repair must
    // be reviewed in the editor; it cannot ride along with an ordinary Save.
    const candidate = structuredClone(request.treeJson);
    candidate.status = "DRAFT";
    if (stable(candidate.meta?.productImages) !== stable((active.treeJson as any)?.meta?.productImages)) {
      throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_INVALID", "Product images must be saved through the Image Manager.");
    }
    const materialAuthority = normalizePbv2ChoiceConsumptionMaterialAuthority(candidate);
    if (stable(materialAuthority.tree) !== stable(candidate)) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_REPAIR_REQUIRED", "PBV2 Material compatibility repairs require review before saving.",
      materialAuthority.changes,
    );
    const pricing = normalizeCanonicalProductPricingTree(candidate);
    if (stable(pricing.tree) !== stable(candidate)) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_REPAIR_REQUIRED", "PBV2 pricing matrix repairs require review before saving.",
      pricing.sanitizerChanges,
    );
    const optionFindings = validateCanonicalPbv2OptionConfigurationTree(candidate, true);
    if (optionFindings.length) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_INVALID", "PBV2 options are invalid. Review the Options Builder.", optionFindings,
    );
    const materialIds = collectPbv2MaterialValidationIds({
      treeJson: candidate, productPrimaryMaterialId: proposedMaterialId,
    });
    const materialRows = materialIds.length
      ? await tx.select({ id: materials.id, name: materials.name, sku: materials.sku, weightOzPerBasis: materials.weightOzPerBasis })
          .from(materials).where(and(eq(materials.organizationId, input.organizationId), inArray(materials.id, materialIds)))
      : [];
    const [formula] = proposed.pricingFormulaId
      ? await tx.select({ id: pricingFormulas.id, isActive: pricingFormulas.isActive })
          .from(pricingFormulas).where(and(eq(pricingFormulas.organizationId, input.organizationId), eq(pricingFormulas.id, proposed.pricingFormulaId))).limit(1)
      : [];
    if (proposed.pricingFormulaId && !formula) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_INVALID", "Select a Formula Library entry in this organization.",
    );
    const validation = validateCanonicalProductPublishTarget({
      product: {
        id: current.id,
        organizationId: current.organizationId,
        name: String(proposed.name),
        isActive: Boolean(proposed.isActive),
        primaryMaterialId: proposedMaterialId,
        pbv2ActiveTreeVersionId: active.id,
        updatedAt: current.updatedAt,
        pricingEngine: proposed.pricingEngine as typeof current.pricingEngine,
        pricingFormulaId: proposed.pricingFormulaId,
      },
      tree: { ...active, status: "DRAFT", treeJson: candidate },
      materials: materialRows,
      pricingFormula: formula ?? null,
    });
    if (stable(validation.treeJson) !== stable(candidate)) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_REPAIR_REQUIRED", "PBV2 validation proposed configuration changes. Review them before saving.",
    );
    if (validation.errors.length) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_INVALID", "Review PBV2 validation errors before saving.", validation.errors,
    );
    if (validation.warnings.length && request.confirmWarnings !== true) throw new CanonicalProductEditorSaveError(
      "PRODUCT_SAVE_WARNINGS_CONFIRM_REQUIRED", "Review and confirm PBV2 warnings before saving.", validation.warnings,
    );
    const nextTreeJson = { ...candidate, status: "ACTIVE" };
    const oldTreeJson = { ...active.treeJson, status: "ACTIVE" };
    const metadataChanged = Object.entries(metadata).some(([key, value]) => stable(value) !== stable((current as any)[key]));
    if (!metadataChanged && stable(nextTreeJson) === stable(oldTreeJson)) {
      return { product: current, activeTreeVersionId: active.id, unchanged: true };
    }

    const now = new Date();
    const [updated] = await tx.update(products).set({ ...metadata, updatedAt: now } as any).where(and(
      eq(products.organizationId, input.organizationId), eq(products.id, input.productId),
      eq(products.updatedAt, current.updatedAt), eq(products.pbv2ActiveTreeVersionId, active.id),
    )).returning();
    if (!updated) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_STALE", "The Product changed during Save. Reload before retrying.");
    const [deprecated] = await tx.update(pbv2TreeVersions).set({
      status: "DEPRECATED", updatedAt: now, updatedByUserId: input.actorUserId,
    }).where(and(
      eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, active.id),
      eq(pbv2TreeVersions.status, "ACTIVE"),
    )).returning({ id: pbv2TreeVersions.id });
    if (!deprecated) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_STALE", "The previous PBV2 version changed during Save.");
    const [newTree] = await tx.insert(pbv2TreeVersions).values({
      organizationId: input.organizationId, productId: input.productId, status: "ACTIVE",
      schemaVersion: 2, treeJson: nextTreeJson, publishedAt: now,
      createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId,
    }).returning();
    if (!newTree) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_INVALID", "The PBV2 version could not be published.");
    const [publishedProduct] = await tx.update(products).set({
      pbv2ActiveTreeVersionId: newTree.id, optionTreeJson: nextTreeJson,
    }).where(and(
      eq(products.organizationId, input.organizationId), eq(products.id, input.productId),
      eq(products.updatedAt, now), eq(products.pbv2ActiveTreeVersionId, active.id),
    )).returning();
    if (!publishedProduct) throw new CanonicalProductEditorSaveError("PRODUCT_SAVE_STALE", "The Product changed during publication.");
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId, userId: input.actorUserId,
      entityType: "product", entityId: input.productId,
      actionType: "product_configuration_published",
      description: `Saved and published Product ${publishedProduct.name} configuration ${newTree.id}${input.auditContext ? ` via ${input.auditContext.source}` : ""}.`,
      oldValues: { activeTreeVersionId: active.id, productUpdatedAt: current.updatedAt, ...(input.auditContext ? { configuration: input.auditContext.before } : {}) },
      newValues: { activeTreeVersionId: newTree.id, operationReference: "products.save_live_editor_configuration.v1", ...(input.auditContext ? { configuration: input.auditContext.after, operationId: input.auditContext.reference } : {}) },
    });
    return { product: publishedProduct, activeTreeVersionId: newTree.id, unchanged: false };
  });
}
