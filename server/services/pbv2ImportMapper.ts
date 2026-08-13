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
import { eq, and, inArray } from "drizzle-orm";
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
  /** Source material UUID -> trusted destination material UUID. */
  treeMaterialIdMap?: Record<string, string>;
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
  const activeTreeJson = remapPbv2TreeMaterialIds(item.pbv2?.activeTree?.treeJson ?? item.optionTreeJson, resolved.treeMaterialIdMap);
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

type PortableMaterialMapping = { id: string; sku: string; name?: string };
type MaterialReferenceIssue = { code: string; message: string; field: string };

function normalizedSku(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function materialMapBySku(materialRows: readonly any[]): Map<string, any[]> {
  const result = new Map<string, any[]>();
  for (const material of materialRows) {
    const sku = normalizedSku(material.sku);
    if (!sku) continue;
    const current = result.get(sku) ?? [];
    current.push(material);
    result.set(sku, current);
  }
  return result;
}

function collectTreeMaterialIds(value: unknown, path = "tree"): Array<{ materialId: string; path: string }> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectTreeMaterialIds(entry, `${path}[${index}]`));
  const record = value as Record<string, unknown>;
  const refs: Array<{ materialId: string; path: string }> = [];
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (key === "materialId" && typeof child === "string" && child.trim()) refs.push({ materialId: child.trim(), path: childPath });
    refs.push(...collectTreeMaterialIds(child, childPath));
  }
  return refs;
}

/** Maps every PBV2 material reference only after it has been resolved to a
 * destination-tenant Material. It deliberately never falls back to source IDs. */
export function remapPbv2TreeMaterialIds(treeJson: unknown, materialIdMap?: Record<string, string>): any {
  if (!treeJson || typeof treeJson !== "object") return treeJson;
  const cloned = cloneJson(treeJson);
  if (!materialIdMap || Object.keys(materialIdMap).length === 0) return cloned;
  const rewrite = (value: any): any => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === "materialId" && typeof child === "string" && materialIdMap[child.trim()] ? materialIdMap[child.trim()] : rewrite(child),
    ]));
  };
  return rewrite(cloned);
}

export function resolvePortableMaterialReferences(
  item: ProductExportV2Item,
  sourceMappings: readonly PortableMaterialMapping[] | undefined,
  targetBySku: Map<string, any[]>,
): { resolved: ResolvedReferences; issues: MaterialReferenceIssue[] } {
  const resolved: ResolvedReferences = {};
  const issues: MaterialReferenceIssue[] = [];
  const sourceById = new Map<string, PortableMaterialMapping[]>();
  for (const mapping of sourceMappings ?? []) {
    const sku = normalizedSku(mapping.sku);
    if (!mapping.id || !sku) continue;
    const current = sourceById.get(mapping.id) ?? [];
    current.push(mapping);
    sourceById.set(mapping.id, current);
  }
  const destinationForSku = (skuValue: unknown, field: string): string | null => {
    const matches = targetBySku.get(normalizedSku(skuValue)) ?? [];
    if (matches.length === 1) return matches[0]!.id;
    issues.push({
      code: matches.length > 1 ? "MATERIAL_REFERENCE_AMBIGUOUS" : "MATERIAL_REFERENCE_UNRESOLVED",
      message: matches.length > 1
        ? `Material SKU "${String(skuValue)}" matches multiple target materials; select one explicitly before importing.`
        : `Material SKU "${String(skuValue)}" could not be matched in the target organization.`,
      field,
    });
    return null;
  };
  if (item.primaryMaterialSku) {
    const materialId = destinationForSku(item.primaryMaterialSku, "primaryMaterialSku");
    if (materialId) resolved.primaryMaterialId = materialId;
  }
  const references = [
    ...collectTreeMaterialIds(item.pbv2?.activeTree?.treeJson, "pbv2.activeTree.treeJson"),
    ...collectTreeMaterialIds(item.pbv2?.draftTree?.treeJson, "pbv2.draftTree.treeJson"),
    ...(!item.pbv2?.activeTree?.treeJson ? collectTreeMaterialIds(item.optionTreeJson, "optionTreeJson") : []),
  ];
  const idMap: Record<string, string> = {};
  for (const reference of references) {
    if (idMap[reference.materialId]) continue;
    const sourceMatches = sourceById.get(reference.materialId) ?? [];
    if (sourceMatches.length !== 1) {
      issues.push({
        code: sourceMatches.length > 1 ? "MATERIAL_PORTABLE_REFERENCE_AMBIGUOUS" : "MATERIAL_PORTABLE_REFERENCE_MISSING",
        message: sourceMatches.length > 1
          ? `PBV2 material reference at ${reference.path} has multiple source mapping records.`
          : `PBV2 material reference at ${reference.path} has no portable source SKU mapping and cannot safely be imported.`,
        field: reference.path,
      });
      continue;
    }
    const materialId = destinationForSku(sourceMatches[0]!.sku, reference.path);
    if (materialId) idMap[reference.materialId] = materialId;
  }
  if (Object.keys(idMap).length) resolved.treeMaterialIdMap = idMap;
  return { resolved, issues };
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
  const materialBySku = materialMapBySku(allMaterials);
  
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
    
    const materialResolution = resolvePortableMaterialReferences(item, request.mappings?.materials, materialBySku);
    Object.assign(dryItem.resolved, materialResolution.resolved);
    dryItem.errors.push(...materialResolution.issues);
    
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

    if (item.exportWarnings?.includes("NO_CUSTOMER_OPTIONS")) {
      dryItem.warnings.push({
        code: "NO_CUSTOMER_OPTIONS",
        message: "Product has PBV2 pricing/runtime data but no customer-facing option selections.",
        field: "exportWarnings",
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
  const materialBySku = materialMapBySku(allMaterials);
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
      const materialResolution = resolvePortableMaterialReferences(item, request.mappings?.materials, materialBySku);
      if (materialResolution.issues.length) {
        throw Object.assign(new Error(materialResolution.issues[0]!.message), { code: materialResolution.issues[0]!.code });
      }
      Object.assign(resolved, materialResolution.resolved);
      
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
    importedSummary = await replacePbv2TreesForProduct(tx as TxClient, ctx, productId, item, resolved, treeUserId);
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
    importedSummary = await replacePbv2TreesForProduct(tx as TxClient, ctx, productId, item, resolved, treeUserId);
  });
  
  return { productId, summary: importedSummary };
}

function getActiveTreeForImport(item: ProductExportV2Item, resolved: ResolvedReferences): { schemaVersion: number; treeJson: Record<string, any>; publishedAt?: string | null } | undefined {
  if (item.pbv2?.activeTree?.treeJson) {
    return {
      schemaVersion: item.pbv2.activeTree.schemaVersion || 1,
      treeJson: remapPbv2TreeMaterialIds(item.pbv2.activeTree.treeJson, resolved.treeMaterialIdMap),
      publishedAt: item.pbv2.activeTree.publishedAt,
    };
  }
  if (item.optionTreeJson && typeof item.optionTreeJson === "object") {
    return {
      schemaVersion: 1,
      treeJson: remapPbv2TreeMaterialIds(item.optionTreeJson, resolved.treeMaterialIdMap) as Record<string, any>,
      publishedAt: null,
    };
  }
  return undefined;
}

function getDraftTreeForImport(item: ProductExportV2Item, activeTree: { schemaVersion: number; treeJson: Record<string, any> } | undefined, resolved: ResolvedReferences): { schemaVersion: number; treeJson: Record<string, any> } | undefined {
  if (item.pbv2?.draftTree?.treeJson) {
    return {
      schemaVersion: item.pbv2.draftTree.schemaVersion || activeTree?.schemaVersion || 1,
      treeJson: remapPbv2TreeMaterialIds(item.pbv2.draftTree.treeJson, resolved.treeMaterialIdMap),
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
  resolved: ResolvedReferences,
  treeUserId: string | null,
): Promise<ProductImportExportSummary> {
  const activeTree = getActiveTreeForImport(item, resolved);
  const draftTree = getDraftTreeForImport(item, activeTree, resolved);
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
      .set({ pbv2ActiveTreeVersionId: null, optionTreeJson: remapPbv2TreeMaterialIds(item.optionTreeJson, resolved.treeMaterialIdMap) ?? null } as any)
      .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)));
    return importedSummary;
  }

  // Existing Order lines retain their PBV2 tree-version IDs for pricing and
  // Prepress material planning.  Archive superseded editable versions instead
  // of deleting them during an upsert import, then create fresh imported
  // ACTIVE/DRAFT versions below.
  await dbClient
    .update(pbv2TreeVersions)
    .set({ status: "ARCHIVED", updatedAt: new Date(), updatedByUserId: treeUserId } as any)
    .where(and(
      eq(pbv2TreeVersions.productId, productId),
      eq(pbv2TreeVersions.organizationId, ctx.organizationId),
      inArray(pbv2TreeVersions.status, ["ACTIVE", "DRAFT"]),
    ));

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
  
  const hasNodeList = Array.isArray(treeJson.rootNodeIds) || Array.isArray(treeJson.nodes) || Boolean(treeJson.nodes && typeof treeJson.nodes === "object");
  const hasRuntimeRoot = Boolean(treeJson.root && typeof treeJson.root === "object");
  const hasStructuralCollections = ["children", "groups", "questions", "fields", "inputs", "options"].some((key) => {
    const value = treeJson[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === "object");
  });
  const meta = treeJson.meta && typeof treeJson.meta === "object" ? treeJson.meta : {};
  const hasRuntimePricing = Boolean(
    treeJson.pricingMatrix ||
    treeJson.pricingConfig ||
    treeJson.pricingFormula ||
    meta.pricingMatrix ||
    meta.pricingV2 ||
    meta.pricingFormula ||
    meta.pricingFormulaVariables
  );

  if (!hasNodeList && !hasRuntimeRoot && !hasStructuralCollections && !hasRuntimePricing) {
    return { ok: false, error: "Tree must have nodes, a runtime root, structural collections, or runtime pricing data" };
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
