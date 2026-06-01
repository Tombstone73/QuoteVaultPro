/**
 * PBV2 Product Import Mapper
 * 
 * Validates and transforms portable product JSON into database writes.
 * Handles conflict resolution, reference lookups, and atomic PBV2 tree creation.
 * 
 * Key principles:
 * - Never create partial PBV2 trees (atomic transaction per product)
 * - Resolve stable keys (SKU, slug, name) to database IDs
 * - Support dry-run mode for validation and preview
 * - Provide actionable error messages with context
 */

import type { 
  ProductImportV2Request, 
  ProductExportV2Item, 
  ImportPlan, 
  ImportResult,
  ImportMode,
  ProductImportExportSummary,
} from "@shared/importExportSchemas";
import { summarizeProductExportItem } from "@shared/importExportSchemas";
import type { db as DbType } from "../db";
import { products, pbv2TreeVersions, productTypes, materials, users } from "@shared/schema";
import { sanitizeLegacyPriceBreaksForPbv2 } from "@shared/pbv2/legacyPriceBreaks";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

type DbClient = typeof DbType;
type TxClient = any;

export interface ImportMapperContext {
  db: DbClient;
  organizationId: string;
  userId: string;
  mode: ImportMode;
}

export interface ResolvedReferences {
  productTypeId?: string;
  primaryMaterialId?: string;
}

interface DryRunItem {
  productIndex: number;
  productName: string;
  action: "create" | "update" | "skip";
  existingId?: string;
  reason?: string;
  warnings: Array<{ code: string; message: string; field?: string }>;
  errors: Array<{ code: string; message: string; field?: string }>;
  resolved: ResolvedReferences;
}

export function buildPbv2ImportProductValues(
  item: ProductExportV2Item,
  resolved: ResolvedReferences,
  extraValues: Record<string, unknown> = {},
): Record<string, unknown> {
  const activeTreeJson = item.pbv2?.activeTree?.treeJson ?? item.optionTreeJson;
  const productValues = sanitizeLegacyPriceBreaksForPbv2({
    ...extraValues,
    name: item.name,
    description: item.description,
    category: item.category,
    productTypeId: resolved.productTypeId,
    pricingMode: item.pricingMode,
    pricingFormula: item.pricingFormula,
    pricingEngine: item.pricingEngine,
    pricingProfileKey: item.pricingProfileKey,
    pricingProfileConfig: item.pricingProfileConfig,
    primaryMaterialId: resolved.primaryMaterialId,
    useNestingCalculator: item.useNestingCalculator,
    sheetWidth: item.sheetWidth?.toString(),
    sheetHeight: item.sheetHeight?.toString(),
    materialType: item.materialType,
    minPricePerItem: item.minPricePerItem?.toString(),
    nestingVolumePricing: item.nestingVolumePricing,
    priceBreaks: item.priceBreaks,
    isService: item.isService,
    requiresProductionJob: item.requiresProductionJob,
    isTaxable: item.isTaxable,
    isActive: item.isActive,
    artworkPolicy: item.artworkPolicy,
    variantLabel: item.variantLabel,
    storeUrl: item.storeUrl,
    showStoreLink: item.showStoreLink,
    thumbnailUrls: item.thumbnailUrls,
    optionsJson: item.optionsJson,
    optionTreeJson: activeTreeJson,
    pbv2: item.pbv2,
  });
  const { pbv2: _pbv2, ...dbValues } = productValues;
  return dbValues;
}

/**
 * Dry-run: validate and build import plan
 */
export async function buildImportPlan(
  ctx: ImportMapperContext,
  request: ProductImportV2Request
): Promise<ImportPlan> {
  
  // Validate schema version
  if (!request.schemaVersion.startsWith("products-export/v")) {
    throw new Error(`Unsupported schema version: ${request.schemaVersion}`);
  }
  
  const dryRunItems: DryRunItem[] = [];
  
  // Load existing products in org for conflict detection
  const existingProducts = await ctx.db
    .select({ id: products.id, name: products.name, slug: products.name }) // Use name as slug proxy
    .from(products)
    .where(eq(products.organizationId, ctx.organizationId));
  
  const existingBySlug = new Map(
    existingProducts.map(p => [generateSlugFromName(p.name), p])
  );
  
  // Load reference data for validation
  const [allProductTypes, allMaterials] = await Promise.all([
    ctx.db.select().from(productTypes).where(eq(productTypes.organizationId, ctx.organizationId)),
    ctx.db.select().from(materials).where(eq(materials.organizationId, ctx.organizationId)),
  ]);
  
  const productTypeByName = new Map(allProductTypes.map(pt => [pt.name.toLowerCase(), pt]));
  const materialBySku = new Map(allMaterials.map(m => [m.sku.toLowerCase(), m]));
  
  for (let i = 0; i < request.products.length; i++) {
    const item = request.products[i];
    const itemSummary = summarizeProductExportItem(item);
    const dryItem: DryRunItem = {
      productIndex: i,
      productName: item.name,
      action: "create",
      warnings: [],
      errors: [],
      resolved: {},
    };
    
    // Resolve references
    if (item.productTypeName) {
      const pt = productTypeByName.get(item.productTypeName.toLowerCase());
      if (pt) {
        dryItem.resolved.productTypeId = pt.id;
      } else {
        dryItem.warnings.push({
          code: "PRODUCT_TYPE_NOT_FOUND",
          message: `Product type "${item.productTypeName}" not found in target org. Will be set to null.`,
          field: "productTypeName",
        });
      }
    }
    
    if (item.primaryMaterialSku) {
      const mat = materialBySku.get(item.primaryMaterialSku.toLowerCase());
      if (mat) {
        dryItem.resolved.primaryMaterialId = mat.id;
      } else {
        dryItem.warnings.push({
          code: "MATERIAL_NOT_FOUND",
          message: `Material SKU "${item.primaryMaterialSku}" not found in target org. Will be set to null.`,
          field: "primaryMaterialSku",
        });
      }
    }
    
    // Check for conflicts
    const slug = item.slug || generateSlugFromName(item.name);
    const existing = existingBySlug.get(slug);
    
    if (existing) {
      if (ctx.mode === "requireExplicitConflictResolution") {
        dryItem.errors.push({
          code: "DUPLICATE_PRODUCT",
          message: `Product with slug "${slug}" already exists (ID: ${existing.id}). Mode requires explicit conflict resolution.`,
          field: "slug",
        });
        dryItem.action = "skip";
      } else if (ctx.mode === "upsertBySlug") {
        dryItem.action = "update";
        dryItem.existingId = existing.id;
        dryItem.reason = `Updating existing product (slug: ${slug})`;
      }
    }
    
    // Validate PBV2 tree structure if present
    if (item.pbv2?.activeTree?.treeJson) {
      const treeValidation = validatePbv2TreeStructure(item.pbv2.activeTree.treeJson);
      if (!treeValidation.ok) {
        dryItem.errors.push({
          code: "INVALID_PBV2_TREE",
          message: `Active tree validation failed: ${treeValidation.error}`,
          field: "pbv2.activeTree",
        });
      }
    } else if (item.optionTreeJson) {
      dryItem.warnings.push({
        code: "PBV2_ACTIVE_TREE_RECOVERED_FROM_PRODUCT",
        message: "PBV2 active tree version is missing; runtime optionTreeJson will be used for import.",
        field: "optionTreeJson",
      });
    } else if (item.pbv2) {
      dryItem.warnings.push({
        code: "PBV2_ACTIVE_TREE_MISSING",
        message: "No PBV2 active tree found. Imported product will not have builder/runtime options.",
        field: "pbv2.activeTree",
      });
    }

    if ((item.optionCount ?? 0) > 0 && itemSummary.optionCount === 0) {
      dryItem.errors.push({
        code: "PBV2_OPTIONS_MISSING_FROM_TREE",
        message: `Export declares ${item.optionCount} PBV2 options, but the importable tree contains zero options.`,
        field: "pbv2.activeTree.treeJson",
      });
    }
    
    if (item.pbv2?.draftTree?.treeJson) {
      const treeValidation = validatePbv2TreeStructure(item.pbv2.draftTree.treeJson);
      if (!treeValidation.ok) {
        dryItem.errors.push({
          code: "INVALID_PBV2_TREE",
          message: `Draft tree validation failed: ${treeValidation.error}`,
          field: "pbv2.draftTree",
        });
      }
    }
    
    // Basic field validation
    if (!item.name || item.name.trim().length === 0) {
      dryItem.errors.push({
        code: "MISSING_REQUIRED_FIELD",
        message: "Product name is required",
        field: "name",
      });
    }
    
    dryRunItems.push(dryItem);
  }
  
  // Aggregate results
  const allWarnings = dryRunItems.flatMap(item =>
    item.warnings.map(w => ({
      productIndex: item.productIndex,
      productName: item.productName,
      code: w.code,
      message: w.message,
      field: w.field,
    }))
  );
  
  const allErrors = dryRunItems.flatMap(item =>
    item.errors.map(e => ({
      productIndex: item.productIndex,
      productName: item.productName,
      code: e.code,
      message: e.message,
      field: e.field,
    }))
  );
  
  const preview = dryRunItems.map(item => ({
    productIndex: item.productIndex,
    productName: item.productName,
    category: request.products[item.productIndex]?.category,
    status: request.products[item.productIndex]?.isActive === false ? "inactive" : "active",
    ...summarizeProductExportItem(request.products[item.productIndex]),
    action: item.action,
    existingId: item.existingId,
    reason: item.reason,
    warnings: item.warnings.map((warning) => warning.message),
  }));
  
  const counts = {
    total: dryRunItems.length,
    create: dryRunItems.filter(i => i.action === "create").length,
    update: dryRunItems.filter(i => i.action === "update").length,
    skip: dryRunItems.filter(i => i.action === "skip").length,
  };
  
  return {
    counts,
    warnings: allWarnings,
    errors: allErrors,
    preview,
  };
}

/**
 * Apply import: create/update products with PBV2 trees
 */
export async function applyImport(
  ctx: ImportMapperContext,
  request: ProductImportV2Request
): Promise<ImportResult> {
  
  // First run dry-run to validate
  const plan = await buildImportPlan(ctx, request);
  
  if (plan.errors.length > 0) {
    // Cannot apply with errors
    return {
      success: false,
      counts: {
        total: plan.counts.total,
        created: 0,
        updated: 0,
        skipped: plan.counts.total,
        failed: 0,
      },
      created: [],
      updated: [],
      failed: plan.errors.map(e => ({
        productIndex: e.productIndex,
        productName: e.productName,
        error: e.message,
        code: e.code,
      })),
    };
  }
  
  // Load reference data
  const [allProductTypes, allMaterials, existingProducts] = await Promise.all([
    ctx.db.select().from(productTypes).where(eq(productTypes.organizationId, ctx.organizationId)),
    ctx.db.select().from(materials).where(eq(materials.organizationId, ctx.organizationId)),
    ctx.db.select().from(products).where(eq(products.organizationId, ctx.organizationId)),
  ]);
  
  const productTypeByName = new Map(allProductTypes.map(pt => [pt.name.toLowerCase(), pt]));
  const materialBySku = new Map(allMaterials.map(m => [m.sku.toLowerCase(), m]));
  const existingBySlug = new Map(
    existingProducts.map(p => [generateSlugFromName(p.name), p])
  );
  
  const result: ImportResult = {
    success: true,
    counts: {
      total: request.products.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    },
    created: [],
    updated: [],
    failed: [],
  };
  
  for (let i = 0; i < request.products.length; i++) {
    const item = request.products[i];
    
    try {
      // Resolve references
      const resolved: ResolvedReferences = {};
      if (item.productTypeName) {
        const pt = productTypeByName.get(item.productTypeName.toLowerCase());
        if (pt) resolved.productTypeId = pt.id;
      }
      if (item.primaryMaterialSku) {
        const mat = materialBySku.get(item.primaryMaterialSku.toLowerCase());
        if (mat) resolved.primaryMaterialId = mat.id;
      }
      
      const slug = item.slug || generateSlugFromName(item.name);
      const existing = existingBySlug.get(slug);
      
      if (existing && ctx.mode === "upsertBySlug") {
        // Update existing product
        const imported = await updateProductWithPbv2(ctx, existing.id, item, resolved);
        result.updated.push({
          productIndex: i,
          productName: item.name,
          productId: imported.productId,
          ...imported.summary,
        });
        result.counts.updated++;
      } else if (!existing) {
        // Create new product
        const imported = await createProductWithPbv2(ctx, item, resolved);
        result.created.push({
          productIndex: i,
          productName: item.name,
          productId: imported.productId,
          ...imported.summary,
        });
        result.counts.created++;
      } else {
        // Skip (conflict in requireExplicitConflictResolution mode)
        result.counts.skipped++;
      }
    } catch (error: any) {
      result.failed.push({
        productIndex: i,
        productName: item.name,
        error: error.message || "Unknown error",
        code: error.code || "IMPORT_ERROR",
      });
      result.counts.failed++;
      result.success = false;
    }
  }
  
  return result;
}

/**
 * Create new product with PBV2 trees atomically
 */
async function createProductWithPbv2(
  ctx: ImportMapperContext,
  item: ProductExportV2Item,
  resolved: ResolvedReferences
): Promise<{ productId: string; summary: ProductImportExportSummary }> {
  const productId = randomUUID();
  const treeUserId = await resolveExistingTreeUserId(ctx.db, ctx.userId);
  const insertValues = buildPbv2ImportProductValues(item, resolved, {
    id: productId,
    organizationId: ctx.organizationId,
  });
  let importedSummary = summarizeProductExportItem(item);
  
  await ctx.db.transaction(async (tx) => {
    await tx.insert(products).values(insertValues as any);
    importedSummary = await replacePbv2TreesForProduct(tx as TxClient, ctx, productId, item, treeUserId);
  });
  
  return { productId, summary: importedSummary };
}

/**
 * Update existing product with PBV2 trees atomically
 */
async function updateProductWithPbv2(
  ctx: ImportMapperContext,
  productId: string,
  item: ProductExportV2Item,
  resolved: ResolvedReferences
): Promise<{ productId: string; summary: ProductImportExportSummary }> {
  const treeUserId = await resolveExistingTreeUserId(ctx.db, ctx.userId);
  const updateValues = buildPbv2ImportProductValues(item, resolved, {
    updatedAt: new Date(),
  });
  let importedSummary = summarizeProductExportItem(item);
  
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(products)
      .set(updateValues as any)
      .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)));
    importedSummary = await replacePbv2TreesForProduct(tx as TxClient, ctx, productId, item, treeUserId);
  });
  
  return { productId, summary: importedSummary };
}

function getActiveTreeForImport(item: ProductExportV2Item): { schemaVersion: number; treeJson: Record<string, any>; publishedAt?: string | null } | undefined {
  if (item.pbv2?.activeTree?.treeJson) {
    return {
      schemaVersion: item.pbv2.activeTree.schemaVersion || 1,
      treeJson: item.pbv2.activeTree.treeJson,
      publishedAt: item.pbv2.activeTree.publishedAt,
    };
  }
  if (item.optionTreeJson && typeof item.optionTreeJson === "object") {
    return {
      schemaVersion: 1,
      treeJson: item.optionTreeJson as Record<string, any>,
      publishedAt: null,
    };
  }
  return undefined;
}

function getDraftTreeForImport(item: ProductExportV2Item, activeTree: { schemaVersion: number; treeJson: Record<string, any> } | undefined): { schemaVersion: number; treeJson: Record<string, any> } | undefined {
  if (item.pbv2?.draftTree?.treeJson) {
    return {
      schemaVersion: item.pbv2.draftTree.schemaVersion || activeTree?.schemaVersion || 1,
      treeJson: item.pbv2.draftTree.treeJson,
    };
  }
  if (!activeTree) return undefined;
  const draftTreeJson = cloneJson(activeTree.treeJson);
  if (draftTreeJson && typeof draftTreeJson === "object" && !Array.isArray(draftTreeJson)) {
    (draftTreeJson as Record<string, any>).status = "DRAFT";
  }
  return {
    schemaVersion: activeTree.schemaVersion,
    treeJson: draftTreeJson,
  };
}

async function replacePbv2TreesForProduct(
  dbClient: TxClient,
  ctx: ImportMapperContext,
  productId: string,
  item: ProductExportV2Item,
  treeUserId: string | null,
): Promise<ProductImportExportSummary> {
  const activeTree = getActiveTreeForImport(item);
  const draftTree = getDraftTreeForImport(item, activeTree);
  const activeTreeJson = activeTree?.treeJson ?? null;
  const sourceSummary = summarizeProductExportItem(item);
  const importedSummary = summarizeProductExportItem({
    ...item,
    optionTreeJson: activeTreeJson ?? item.optionTreeJson,
    pbv2: activeTree
      ? {
          hasActiveTree: true,
          activeTree: {
            schemaVersion: activeTree.schemaVersion,
            treeJson: activeTree.treeJson,
            publishedAt: activeTree.publishedAt ?? null,
          },
          hasDraft: Boolean(draftTree),
          draftTree: draftTree
            ? {
                schemaVersion: draftTree.schemaVersion,
                treeJson: draftTree.treeJson,
              }
            : undefined,
        }
      : item.pbv2,
  });

  if (sourceSummary.optionCount > 0 && importedSummary.optionCount === 0) {
    throw new Error(
      `PBV2 import for "${item.name}" would create a zero-option product from a source with ${sourceSummary.optionCount} options. Import aborted.`,
    );
  }

  if (!activeTree && !draftTree) {
    await dbClient
      .update(products)
      .set({ pbv2ActiveTreeVersionId: null, optionTreeJson: item.optionTreeJson ?? null } as any)
      .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)));
    return importedSummary;
  }

  await dbClient
    .delete(pbv2TreeVersions)
    .where(
      and(
        eq(pbv2TreeVersions.productId, productId),
        eq(pbv2TreeVersions.organizationId, ctx.organizationId),
      ),
    );

  let activeTreeId: string | undefined;

  if (activeTree) {
    activeTreeId = randomUUID();
    await dbClient.insert(pbv2TreeVersions).values({
      id: activeTreeId,
      organizationId: ctx.organizationId,
      productId,
      status: "ACTIVE",
      schemaVersion: activeTree.schemaVersion,
      treeJson: activeTree.treeJson,
      publishedAt: activeTree.publishedAt ? new Date(activeTree.publishedAt) : new Date(),
      createdByUserId: treeUserId,
      updatedByUserId: treeUserId,
    } as any);
  }

  if (draftTree) {
    await dbClient.insert(pbv2TreeVersions).values({
      id: randomUUID(),
      organizationId: ctx.organizationId,
      productId,
      status: "DRAFT",
      schemaVersion: draftTree.schemaVersion,
      treeJson: draftTree.treeJson,
      publishedAt: null,
      createdByUserId: treeUserId,
      updatedByUserId: treeUserId,
    } as any);
  }

  await dbClient
    .update(products)
    .set({
      pbv2ActiveTreeVersionId: activeTreeId || null,
      optionTreeJson: activeTreeJson,
    } as any)
    .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)));

  return importedSummary;
}

async function resolveExistingTreeUserId(dbClient: DbClient, userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const [user] = await dbClient
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.id ?? null;
  } catch (error) {
    console.warn("[Product Import] Could not resolve PBV2 tree actor; importing tree without actor FK", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Validate PBV2 tree structure (basic check)
 */
function validatePbv2TreeStructure(treeJson: any): { ok: boolean; error?: string } {
  if (!treeJson || typeof treeJson !== "object") {
    return { ok: false, error: "Tree must be an object" };
  }
  
  if (!Array.isArray(treeJson.rootNodeIds) && !Array.isArray(treeJson.nodes)) {
    return { ok: false, error: "Tree must have rootNodeIds or nodes array" };
  }
  
  // Basic structure check - detailed validation happens at publish time
  return { ok: true };
}

/**
 * Generate a stable slug from product name
 */
function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
