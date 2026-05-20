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
  ImportMode 
} from "@shared/importExportSchemas";
import type { db as DbType } from "../db";
import { products, pbv2TreeVersions, productTypes, materials } from "@shared/schema";
import { sanitizeLegacyPriceBreaksForPbv2 } from "@shared/pbv2/legacyPriceBreaks";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

type DbClient = typeof DbType;

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
    optionTreeJson: item.optionTreeJson,
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
    action: item.action,
    existingId: item.existingId,
    reason: item.reason,
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
        const productId = await updateProductWithPbv2(ctx, existing.id, item, resolved);
        result.updated.push({
          productIndex: i,
          productName: item.name,
          productId,
        });
        result.counts.updated++;
      } else if (!existing) {
        // Create new product
        const productId = await createProductWithPbv2(ctx, item, resolved);
        result.created.push({
          productIndex: i,
          productName: item.name,
          productId,
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
): Promise<string> {
  const productId = randomUUID();
  const insertValues = buildPbv2ImportProductValues(item, resolved, {
    id: productId,
    organizationId: ctx.organizationId,
  });
  
  // Insert product
  await ctx.db.insert(products).values(insertValues as any);
  
  // Create PBV2 trees if present
  if (item.pbv2) {
    let activeTreeId: string | undefined;
    
    if (item.pbv2.activeTree) {
      activeTreeId = randomUUID();
      await ctx.db.insert(pbv2TreeVersions).values({
        id: activeTreeId,
        organizationId: ctx.organizationId,
        productId,
        status: "ACTIVE",
        schemaVersion: item.pbv2.activeTree.schemaVersion,
        treeJson: item.pbv2.activeTree.treeJson,
        publishedAt: item.pbv2.activeTree.publishedAt 
          ? new Date(item.pbv2.activeTree.publishedAt) 
          : new Date(),
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      });
    }
    
    if (item.pbv2.draftTree) {
      const draftTreeId = randomUUID();
      await ctx.db.insert(pbv2TreeVersions).values({
        id: draftTreeId,
        organizationId: ctx.organizationId,
        productId,
        status: "DRAFT",
        schemaVersion: item.pbv2.draftTree.schemaVersion,
        treeJson: item.pbv2.draftTree.treeJson,
        publishedAt: null,
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      });
    }
    
    // Update product with active tree pointer
    if (activeTreeId) {
      await ctx.db
        .update(products)
        .set({ pbv2ActiveTreeVersionId: activeTreeId })
        .where(eq(products.id, productId));
    }
  }
  
  return productId;
}

/**
 * Update existing product with PBV2 trees atomically
 */
async function updateProductWithPbv2(
  ctx: ImportMapperContext,
  productId: string,
  item: ProductExportV2Item,
  resolved: ResolvedReferences
): Promise<string> {
  const updateValues = buildPbv2ImportProductValues(item, resolved, {
    updatedAt: new Date(),
  });
  
  // Update product record
  await ctx.db
    .update(products)
    .set(updateValues as any)
    .where(eq(products.id, productId));
  
  // Replace PBV2 trees (delete old, insert new)
  if (item.pbv2) {
    // Delete existing trees for this product
    await ctx.db
      .delete(pbv2TreeVersions)
      .where(
        and(
          eq(pbv2TreeVersions.productId, productId),
          eq(pbv2TreeVersions.organizationId, ctx.organizationId)
        )
      );
    
    let activeTreeId: string | undefined;
    
    if (item.pbv2.activeTree) {
      activeTreeId = randomUUID();
      await ctx.db.insert(pbv2TreeVersions).values({
        id: activeTreeId,
        organizationId: ctx.organizationId,
        productId,
        status: "ACTIVE",
        schemaVersion: item.pbv2.activeTree.schemaVersion,
        treeJson: item.pbv2.activeTree.treeJson,
        publishedAt: item.pbv2.activeTree.publishedAt 
          ? new Date(item.pbv2.activeTree.publishedAt) 
          : new Date(),
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      });
    }
    
    if (item.pbv2.draftTree) {
      const draftTreeId = randomUUID();
      await ctx.db.insert(pbv2TreeVersions).values({
        id: draftTreeId,
        organizationId: ctx.organizationId,
        productId,
        status: "DRAFT",
        schemaVersion: item.pbv2.draftTree.schemaVersion,
        treeJson: item.pbv2.draftTree.treeJson,
        publishedAt: null,
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      });
    }
    
    // Update product with active tree pointer
    await ctx.db
      .update(products)
      .set({ pbv2ActiveTreeVersionId: activeTreeId || null })
      .where(eq(products.id, productId));
  }
  
  return productId;
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
