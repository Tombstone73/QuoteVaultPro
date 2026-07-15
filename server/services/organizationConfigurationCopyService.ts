import crypto from "crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  globalVariables,
  materialProductLinks,
  materials,
  organizationConfigurationCopyJobs,
  organizations,
  pbv2TreeVersions,
  pricingFormulas,
  productDesignConfigs,
  productOptions,
  productTypes,
  productVariants,
  products,
  productionAlertPresets,
  productionStationSteps,
  taxCategories,
  taxRules,
  taxZones,
} from "@shared/schema";

export type ConfigurationCopyStatus = "pending" | "copying" | "completed" | "failed";
type OrganizationSetupStatus = "DRAFT_REQUEST" | "ORGANIZATION_CREATED" | "CONFIGURATION_COPYING" | "READY" | "COPY_FAILED";

export interface ConfigurationCopyPreview {
  sourceOrganizationId: string;
  sourceOrganizationName: string;
  sourceOrganizationSlug: string;
  entityCounts: Record<string, number>;
  warnings: string[];
}

export interface ConfigurationCopyResult {
  copyJobId: string;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  status: ConfigurationCopyStatus;
  entityCounts: Record<string, number>;
  warnings: string[];
  errorSummary?: string | null;
  errorDetails?: Record<string, unknown> | null;
}

export class OrganizationConfigurationCopyError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "OrganizationConfigurationCopyError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

type DbClient = typeof db;
type TxClient = any;

const CONFIG_TABLES_WITH_ORG = [
  { key: "materials", table: materials },
  { key: "pricingFormulas", table: pricingFormulas },
  { key: "productTypes", table: productTypes },
  { key: "products", table: products },
  { key: "pbv2TreeVersions", table: pbv2TreeVersions },
  { key: "productDesignConfigs", table: productDesignConfigs },
  { key: "materialProductLinks", table: materialProductLinks },
  { key: "taxCategories", table: taxCategories },
  { key: "taxZones", table: taxZones },
  { key: "taxRules", table: taxRules },
  { key: "globalVariables", table: globalVariables },
  { key: "productionAlertPresets", table: productionAlertPresets },
  { key: "productionStationSteps", table: productionStationSteps },
] as const;

function newId(): string {
  return crypto.randomUUID();
}

function sanitizeError(error: unknown): { summary: string; details: Record<string, unknown> } {
  if (error instanceof OrganizationConfigurationCopyError) {
    return {
      summary: error.message,
      details: {
        code: error.code,
        ...(error.details ?? {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      summary: error.message,
      details: {
        name: error.name,
      },
    };
  }

  return {
    summary: "Unknown configuration copy failure.",
    details: {},
  };
}

function replaceIdsDeep(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceIdsDeep(item, idMap));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = replaceIdsDeep(nested, idMap);
    }
    return next;
  }
  return value;
}

async function loadOrganization(client: DbClient | TxClient, organizationId: string) {
  const [org] = await client
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      deleteState: organizations.deleteState,
      settings: organizations.settings,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org ?? null;
}

async function setOrganizationSetupStatus(
  client: DbClient | TxClient,
  organizationId: string,
  setupStatus: OrganizationSetupStatus,
  copyJobId?: string
) {
  const org = await loadOrganization(client, organizationId);
  if (!org) return;
  const nextSettings = {
    ...((org.settings ?? {}) as Record<string, unknown>),
    setupStatus,
    ...(copyJobId ? { setupCopyJobId: copyJobId } : {}),
  };
  await client
    .update(organizations)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
}

async function countRowsByOrg(client: DbClient | TxClient, organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const item of CONFIG_TABLES_WITH_ORG) {
    const rows = await client.select({ id: (item.table as any).id }).from(item.table).where(eq((item.table as any).organizationId, organizationId));
    counts[item.key] = rows.length;
  }

  const sourceProducts = await client.select({ id: products.id }).from(products).where(eq(products.organizationId, organizationId));
  const productIds = sourceProducts.map((row: { id: string }) => row.id);
  if (productIds.length > 0) {
    counts.productVariants = (await client.select({ id: productVariants.id }).from(productVariants).where(inArray(productVariants.productId, productIds))).length;
    counts.productOptions = (await client.select({ id: productOptions.id }).from(productOptions).where(inArray(productOptions.productId, productIds))).length;
  } else {
    counts.productVariants = 0;
    counts.productOptions = 0;
  }
  return counts;
}

function totalCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

async function assertSourceEligible(client: DbClient | TxClient, sourceOrganizationId: string) {
  const source = await loadOrganization(client, sourceOrganizationId);
  if (!source) {
    throw new OrganizationConfigurationCopyError("Source organization not found.", "SOURCE_NOT_FOUND", 404);
  }
  if (source.deleteState && source.deleteState !== "active") {
    throw new OrganizationConfigurationCopyError("Source organization is not active.", "SOURCE_NOT_ACTIVE", 409, {
      deleteState: source.deleteState,
    });
  }
  return source;
}

async function assertDestinationEligible(client: DbClient | TxClient, destinationOrganizationId: string) {
  const destination = await loadOrganization(client, destinationOrganizationId);
  if (!destination) {
    throw new OrganizationConfigurationCopyError("Destination organization not found.", "DESTINATION_NOT_FOUND", 404);
  }
  if (destination.deleteState && destination.deleteState !== "active") {
    throw new OrganizationConfigurationCopyError("Destination organization is not active.", "DESTINATION_NOT_ACTIVE", 409, {
      deleteState: destination.deleteState,
    });
  }
  const counts = await countRowsByOrg(client, destinationOrganizationId);
  if (totalCount(counts) > 0) {
    throw new OrganizationConfigurationCopyError(
      "Destination organization already contains configuration and is not eligible for seeding.",
      "DESTINATION_NOT_EMPTY",
      409,
      { counts }
    );
  }
  return destination;
}

async function insertIfAny(client: TxClient, table: any, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  await client.insert(table).values(rows as any[]);
}

async function validateCopiedGraph(client: TxClient, sourceOrganizationId: string, destinationOrganizationId: string) {
  const copiedProducts = await client.select().from(products).where(eq(products.organizationId, destinationOrganizationId));
  const copiedMaterials = await client.select({ id: materials.id }).from(materials).where(eq(materials.organizationId, destinationOrganizationId));
  const copiedFormulas = await client.select({ id: pricingFormulas.id }).from(pricingFormulas).where(eq(pricingFormulas.organizationId, destinationOrganizationId));
  const copiedProductTypes = await client.select({ id: productTypes.id }).from(productTypes).where(eq(productTypes.organizationId, destinationOrganizationId));

  const materialIds = new Set(copiedMaterials.map((row: { id: string }) => row.id));
  const formulaIds = new Set(copiedFormulas.map((row: { id: string }) => row.id));
  const productTypeIds = new Set(copiedProductTypes.map((row: { id: string }) => row.id));

  for (const product of copiedProducts) {
    if (product.organizationId !== destinationOrganizationId) {
      throw new OrganizationConfigurationCopyError("Copied product has an invalid organization.", "INVALID_PRODUCT_ORG", 500, {
        productId: product.id,
      });
    }
    if (product.primaryMaterialId && !materialIds.has(product.primaryMaterialId)) {
      throw new OrganizationConfigurationCopyError("Copied product references a missing destination material.", "INVALID_PRODUCT_MATERIAL", 500, {
        productId: product.id,
        materialId: product.primaryMaterialId,
      });
    }
    if (product.pricingFormulaId && !formulaIds.has(product.pricingFormulaId)) {
      throw new OrganizationConfigurationCopyError("Copied product references a missing destination formula.", "INVALID_PRODUCT_FORMULA", 500, {
        productId: product.id,
        pricingFormulaId: product.pricingFormulaId,
      });
    }
    if (product.productTypeId && !productTypeIds.has(product.productTypeId)) {
      throw new OrganizationConfigurationCopyError("Copied product references a missing destination product type.", "INVALID_PRODUCT_TYPE", 500, {
        productId: product.id,
        productTypeId: product.productTypeId,
      });
    }

    const serialized = JSON.stringify({
      optionsJson: product.optionsJson,
      optionTreeJson: product.optionTreeJson,
      pricingProfileConfig: product.pricingProfileConfig,
    });
    if (serialized.includes(sourceOrganizationId)) {
      throw new OrganizationConfigurationCopyError("Copied product JSON still references the source organization.", "SOURCE_ORG_REFERENCE", 500, {
        productId: product.id,
      });
    }
  }

  const badLinks = await client
    .select({ id: materialProductLinks.id, materialId: materialProductLinks.materialId, productId: materialProductLinks.productId })
    .from(materialProductLinks)
    .where(and(eq(materialProductLinks.organizationId, destinationOrganizationId), ne(materialProductLinks.organizationId, sourceOrganizationId)));

  const productIds = new Set(copiedProducts.map((row: { id: string }) => row.id));
  for (const link of badLinks) {
    if (!materialIds.has(link.materialId) || !productIds.has(link.productId)) {
      throw new OrganizationConfigurationCopyError("Copied material/product link references a missing destination record.", "INVALID_MATERIAL_PRODUCT_LINK", 500, {
        linkId: link.id,
      });
    }
  }
}

export async function getConfigurationCopyPreview(sourceOrganizationId: string): Promise<ConfigurationCopyPreview> {
  const source = await assertSourceEligible(db, sourceOrganizationId);
  const entityCounts = await countRowsByOrg(db, sourceOrganizationId);
  return {
    sourceOrganizationId,
    sourceOrganizationName: source.name,
    sourceOrganizationSlug: source.slug,
    entityCounts,
    warnings: totalCount(entityCounts) === 0 ? ["Source organization has no product configuration to copy."] : [],
  };
}

export async function listPlatformOrganizationsForSeeding() {
  return await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      deleteState: organizations.deleteState,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.deleteState, "active"))
    .orderBy(organizations.name);
}

export async function listRecentConfigurationCopyJobs(limit = 10) {
  return await db
    .select({
      id: organizationConfigurationCopyJobs.id,
      sourceOrganizationId: organizationConfigurationCopyJobs.sourceOrganizationId,
      destinationOrganizationId: organizationConfigurationCopyJobs.destinationOrganizationId,
      status: organizationConfigurationCopyJobs.status,
      requestedByUserId: organizationConfigurationCopyJobs.requestedByUserId,
      startedAt: organizationConfigurationCopyJobs.startedAt,
      completedAt: organizationConfigurationCopyJobs.completedAt,
      failedAt: organizationConfigurationCopyJobs.failedAt,
      entityCounts: organizationConfigurationCopyJobs.entityCounts,
      warnings: organizationConfigurationCopyJobs.warnings,
      errorSummary: organizationConfigurationCopyJobs.errorSummary,
      errorDetails: organizationConfigurationCopyJobs.errorDetails,
      createdAt: organizationConfigurationCopyJobs.createdAt,
      updatedAt: organizationConfigurationCopyJobs.updatedAt,
    })
    .from(organizationConfigurationCopyJobs)
    .orderBy(desc(organizationConfigurationCopyJobs.createdAt))
    .limit(Math.max(1, Math.min(limit, 50)));
}

export async function getConfigurationCopyJob(jobId: string) {
  const [job] = await db
    .select()
    .from(organizationConfigurationCopyJobs)
    .where(eq(organizationConfigurationCopyJobs.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function copyOrganizationConfiguration(params: {
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  requestedByUserId: string;
  existingJobId?: string;
}): Promise<ConfigurationCopyResult> {
  const { sourceOrganizationId, destinationOrganizationId, requestedByUserId, existingJobId } = params;
  if (sourceOrganizationId === destinationOrganizationId) {
    throw new OrganizationConfigurationCopyError("Source and destination organizations must be different.", "SOURCE_DESTINATION_MATCH", 400);
  }

  await assertSourceEligible(db, sourceOrganizationId);
  await assertDestinationEligible(db, destinationOrganizationId);

  let copyJobId = existingJobId;
  if (copyJobId) {
    const job = await getConfigurationCopyJob(copyJobId);
    if (!job) {
      throw new OrganizationConfigurationCopyError("Copy job not found.", "JOB_NOT_FOUND", 404);
    }
    if (job.status !== "failed") {
      throw new OrganizationConfigurationCopyError("Only failed copy jobs can be retried.", "JOB_NOT_RETRYABLE", 409);
    }
    if (job.sourceOrganizationId !== sourceOrganizationId || job.destinationOrganizationId !== destinationOrganizationId) {
      throw new OrganizationConfigurationCopyError("Retry job source/destination mismatch.", "JOB_SCOPE_MISMATCH", 409);
    }
  } else {
    const [job] = await db
      .insert(organizationConfigurationCopyJobs)
      .values({
        sourceOrganizationId,
        destinationOrganizationId,
        requestedByUserId,
        status: "pending",
      })
      .returning({ id: organizationConfigurationCopyJobs.id });
    copyJobId = job.id;
  }

  await db
    .update(organizationConfigurationCopyJobs)
    .set({
      status: "copying",
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      errorSummary: null,
      errorDetails: null,
      updatedAt: new Date(),
    })
    .where(eq(organizationConfigurationCopyJobs.id, copyJobId));
  await setOrganizationSetupStatus(db, destinationOrganizationId, "CONFIGURATION_COPYING", copyJobId);

  try {
    const { counts, warnings } = await db.transaction(async (tx) => {
      await assertSourceEligible(tx, sourceOrganizationId);
      await assertDestinationEligible(tx, destinationOrganizationId);

      const idMap = new Map<string, string>([[sourceOrganizationId, destinationOrganizationId]]);
      const counts: Record<string, number> = {};
      const warnings: string[] = [];

      const sourceTaxCategories = await tx.select().from(taxCategories).where(eq(taxCategories.organizationId, sourceOrganizationId));
      const taxCategoryRows = sourceTaxCategories.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, ...rest } = row;
        return { ...rest, id, organizationId: destinationOrganizationId };
      });
      await insertIfAny(tx, taxCategories, taxCategoryRows);
      counts.taxCategories = taxCategoryRows.length;

      const sourceTaxZones = await tx.select().from(taxZones).where(eq(taxZones.organizationId, sourceOrganizationId));
      const taxZoneRows = sourceTaxZones.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, ...rest } = row;
        return { ...rest, id, organizationId: destinationOrganizationId };
      });
      await insertIfAny(tx, taxZones, taxZoneRows);
      counts.taxZones = taxZoneRows.length;

      const sourceTaxRules = await tx.select().from(taxRules).where(eq(taxRules.organizationId, sourceOrganizationId));
      const taxRuleRows = sourceTaxRules.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, taxZoneId, taxCategoryId, ...rest } = row;
        return {
          ...rest,
          id,
          organizationId: destinationOrganizationId,
          taxZoneId: idMap.get(taxZoneId) ?? taxZoneId,
          taxCategoryId: idMap.get(taxCategoryId) ?? taxCategoryId,
        };
      });
      await insertIfAny(tx, taxRules, taxRuleRows);
      counts.taxRules = taxRuleRows.length;

      const sourceGlobalVariables = await tx.select().from(globalVariables).where(eq(globalVariables.organizationId, sourceOrganizationId));
      const globalVariableRows = sourceGlobalVariables.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, ...rest } = row;
        return { ...rest, id, organizationId: destinationOrganizationId };
      });
      await insertIfAny(tx, globalVariables, globalVariableRows);
      counts.globalVariables = globalVariableRows.length;

      const sourceProductTypes = await tx.select().from(productTypes).where(eq(productTypes.organizationId, sourceOrganizationId));
      const productTypeRows = sourceProductTypes.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, ...rest } = row;
        return { ...rest, id, organizationId: destinationOrganizationId };
      });
      await insertIfAny(tx, productTypes, productTypeRows);
      counts.productTypes = productTypeRows.length;

      const sourceFormulas = await tx.select().from(pricingFormulas).where(eq(pricingFormulas.organizationId, sourceOrganizationId));
      const formulaRows = sourceFormulas.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, config, ...rest } = row;
        return { ...rest, id, organizationId: destinationOrganizationId, config: replaceIdsDeep(config, idMap) };
      });
      await insertIfAny(tx, pricingFormulas, formulaRows);
      counts.pricingFormulas = formulaRows.length;

      const sourceMaterials = await tx.select().from(materials).where(eq(materials.organizationId, sourceOrganizationId));
      const invalidSourceMaterials = sourceMaterials.filter((row: any) => !row.materialForm || !row.inventoryUnit || !row.consumptionUnit);
      if (invalidSourceMaterials.length > 0) {
        throw new Error(`Cannot copy organization configuration: ${invalidSourceMaterials.length} material record(s) require material form, inventory unit, and consumption unit configuration.`);
      }
      const materialRows = sourceMaterials.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const {
          createdAt,
          updatedAt,
          preferredVendorId,
          specsJson,
          unitOfMeasure: _retiredUnitOfMeasure,
          sellPriceUnit: _retiredSellPriceUnit,
          wholesalePriceUnit: _retiredWholesalePriceUnit,
          wholesaleBaseRate: _retiredWholesaleBaseRate,
          wholesaleMinCharge: _retiredWholesaleMinCharge,
          retailBaseRate: _retiredRetailBaseRate,
          retailMinCharge: _retiredRetailMinCharge,
          ...rest
        } = row;
        return {
          ...rest,
          id,
          organizationId: destinationOrganizationId,
          preferredVendorId: null,
          specsJson: replaceIdsDeep(specsJson, idMap),
        };
      });
      await insertIfAny(tx, materials, materialRows);
      counts.materials = materialRows.length;

      const sourceProducts = await tx.select().from(products).where(eq(products.organizationId, sourceOrganizationId));
      const productRows = sourceProducts.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const {
          createdAt,
          updatedAt,
          productTypeId,
          primaryMaterialId,
          pricingFormulaId,
          optionsJson,
          optionTreeJson,
          pricingProfileConfig,
          pbv2ActiveTreeVersionId,
          ...rest
        } = row;
        idMap.set(pbv2ActiveTreeVersionId, pbv2ActiveTreeVersionId);
        return {
          ...rest,
          id,
          organizationId: destinationOrganizationId,
          productTypeId: productTypeId ? idMap.get(productTypeId) ?? null : null,
          primaryMaterialId: primaryMaterialId ? idMap.get(primaryMaterialId) ?? null : null,
          pricingFormulaId: pricingFormulaId ? idMap.get(pricingFormulaId) ?? null : null,
          optionsJson: replaceIdsDeep(optionsJson, idMap),
          optionTreeJson: replaceIdsDeep(optionTreeJson, idMap),
          pricingProfileConfig: replaceIdsDeep(pricingProfileConfig, idMap),
          pbv2ActiveTreeVersionId: null,
        };
      });
      await insertIfAny(tx, products, productRows);
      counts.products = productRows.length;

      const sourcePbv2Versions = await tx.select().from(pbv2TreeVersions).where(eq(pbv2TreeVersions.organizationId, sourceOrganizationId));
      const pbv2Rows = sourcePbv2Versions.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, createdByUserId, updatedByUserId, productId, treeJson, ...rest } = row;
        return {
          ...rest,
          id,
          organizationId: destinationOrganizationId,
          productId: idMap.get(productId),
          treeJson: replaceIdsDeep(treeJson, idMap),
          createdByUserId: null,
          updatedByUserId: null,
        };
      });
      await insertIfAny(tx, pbv2TreeVersions, pbv2Rows);
      counts.pbv2TreeVersions = pbv2Rows.length;

      for (const product of sourceProducts as any[]) {
        if (!product.pbv2ActiveTreeVersionId) continue;
        const copiedProductId = idMap.get(product.id);
        const copiedTreeVersionId = idMap.get(product.pbv2ActiveTreeVersionId);
        if (!copiedProductId || !copiedTreeVersionId) {
          warnings.push(`Product "${product.name}" active PBV2 tree version was not copied because the source tree version was missing.`);
          continue;
        }
        await tx
          .update(products)
          .set({ pbv2ActiveTreeVersionId: copiedTreeVersionId, updatedAt: new Date() })
          .where(eq(products.id, copiedProductId));
      }

      const sourceProductIds = sourceProducts.map((row: any) => row.id);
      if (sourceProductIds.length > 0) {
        const sourceVariants = await tx.select().from(productVariants).where(inArray(productVariants.productId, sourceProductIds));
        const variantRows = sourceVariants.map((row: any) => {
          const id = newId();
          idMap.set(row.id, id);
          const { createdAt, updatedAt, productId, taxCategoryId, volumePricing, ...rest } = row;
          return {
            ...rest,
            id,
            productId: idMap.get(productId),
            taxCategoryId: taxCategoryId ? idMap.get(taxCategoryId) ?? null : null,
            volumePricing: replaceIdsDeep(volumePricing, idMap),
          };
        });
        await insertIfAny(tx, productVariants, variantRows);
        counts.productVariants = variantRows.length;

        const sourceOptions = await tx.select().from(productOptions).where(inArray(productOptions.productId, sourceProductIds));
        const optionRows = sourceOptions.map((row: any) => {
          const id = newId();
          idMap.set(row.id, id);
          const { createdAt, updatedAt, productId, parentOptionId, ...rest } = row;
          return {
            ...rest,
            id,
            productId: idMap.get(productId),
            parentOptionId: null,
          };
        });
        await insertIfAny(tx, productOptions, optionRows);
        for (const option of sourceOptions as any[]) {
          if (!option.parentOptionId) continue;
          const copiedOptionId = idMap.get(option.id);
          const copiedParentId = idMap.get(option.parentOptionId);
          if (copiedOptionId && copiedParentId) {
            await tx.update(productOptions).set({ parentOptionId: copiedParentId }).where(eq(productOptions.id, copiedOptionId));
          }
        }
        counts.productOptions = optionRows.length;
      } else {
        counts.productVariants = 0;
        counts.productOptions = 0;
      }

      const sourceDesignConfigs = await tx.select().from(productDesignConfigs).where(eq(productDesignConfigs.organizationId, sourceOrganizationId));
      const designRows = sourceDesignConfigs
        .map((row: any) => {
          const copiedProductId = idMap.get(row.productId);
          if (!copiedProductId) return null;
          const id = newId();
          idMap.set(row.id, id);
          const { createdAt, updatedAt, productId, ...rest } = row;
          return { ...rest, id, organizationId: destinationOrganizationId, productId: copiedProductId };
        })
        .filter(Boolean) as Record<string, unknown>[];
      await insertIfAny(tx, productDesignConfigs, designRows);
      counts.productDesignConfigs = designRows.length;

      const sourceMaterialProductLinks = await tx.select().from(materialProductLinks).where(eq(materialProductLinks.organizationId, sourceOrganizationId));
      const materialProductLinkRows = sourceMaterialProductLinks
        .map((row: any) => {
          const copiedMaterialId = idMap.get(row.materialId);
          const copiedProductId = idMap.get(row.productId);
          if (!copiedMaterialId || !copiedProductId) return null;
          const id = newId();
          idMap.set(row.id, id);
          const { createdAt, updatedAt, materialId, productId, ...rest } = row;
          return {
            ...rest,
            id,
            organizationId: destinationOrganizationId,
            materialId: copiedMaterialId,
            productId: copiedProductId,
          };
        })
        .filter(Boolean) as Record<string, unknown>[];
      await insertIfAny(tx, materialProductLinks, materialProductLinkRows);
      counts.materialProductLinks = materialProductLinkRows.length;

      const sourceAlertPresets = await tx.select().from(productionAlertPresets).where(eq(productionAlertPresets.organizationId, sourceOrganizationId));
      const alertPresetRows = sourceAlertPresets.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, createdByUserId, metadataJson, ...rest } = row;
        return {
          ...rest,
          id,
          organizationId: destinationOrganizationId,
          createdByUserId: null,
          metadataJson: replaceIdsDeep(metadataJson, idMap),
        };
      });
      await insertIfAny(tx, productionAlertPresets, alertPresetRows);
      counts.productionAlertPresets = alertPresetRows.length;

      const sourceStationSteps = await tx.select().from(productionStationSteps).where(eq(productionStationSteps.organizationId, sourceOrganizationId));
      const stationStepRows = sourceStationSteps.map((row: any) => {
        const id = newId();
        idMap.set(row.id, id);
        const { createdAt, updatedAt, triggers, ...rest } = row;
        return {
          ...rest,
          id,
          organizationId: destinationOrganizationId,
          triggers: replaceIdsDeep(triggers, idMap),
        };
      });
      await insertIfAny(tx, productionStationSteps, stationStepRows);
      counts.productionStationSteps = stationStepRows.length;

      if (totalCount(counts) === 0) {
        warnings.push("Source organization contained no product configuration records.");
      }

      await validateCopiedGraph(tx, sourceOrganizationId, destinationOrganizationId);
      return { counts, warnings };
    });

    await db
      .update(organizationConfigurationCopyJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        failedAt: null,
        entityCounts: counts,
        warnings,
        errorSummary: null,
        errorDetails: null,
        updatedAt: new Date(),
      })
      .where(eq(organizationConfigurationCopyJobs.id, copyJobId));
    await setOrganizationSetupStatus(db, destinationOrganizationId, "READY", copyJobId);

    return {
      copyJobId,
      sourceOrganizationId,
      destinationOrganizationId,
      status: "completed",
      entityCounts: counts,
      warnings,
      errorSummary: null,
      errorDetails: null,
    };
  } catch (error) {
    const { summary, details } = sanitizeError(error);
    await db
      .update(organizationConfigurationCopyJobs)
      .set({
        status: "failed",
        failedAt: new Date(),
        errorSummary: summary,
        errorDetails: details,
        updatedAt: new Date(),
      })
      .where(eq(organizationConfigurationCopyJobs.id, copyJobId));
    await setOrganizationSetupStatus(db, destinationOrganizationId, "COPY_FAILED", copyJobId);

    return {
      copyJobId,
      sourceOrganizationId,
      destinationOrganizationId,
      status: "failed",
      entityCounts: {},
      warnings: [],
      errorSummary: summary,
      errorDetails: details,
    };
  }
}

export async function retryConfigurationCopyJob(jobId: string, requestedByUserId: string): Promise<ConfigurationCopyResult> {
  const job = await getConfigurationCopyJob(jobId);
  if (!job) {
    throw new OrganizationConfigurationCopyError("Copy job not found.", "JOB_NOT_FOUND", 404);
  }
  return copyOrganizationConfiguration({
    sourceOrganizationId: job.sourceOrganizationId,
    destinationOrganizationId: job.destinationOrganizationId,
    requestedByUserId,
    existingJobId: job.id,
  });
}
