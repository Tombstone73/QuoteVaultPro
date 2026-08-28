/**
 * products.routes.ts
 *
 * Products, PBV2, and Product Options/Variants routes extracted from server/routes.ts.
 * Includes the PBV2 pricing-preview routes that were accidentally removed during a
 * prior extraction pass.
 *
 * Placement: server/routes/products.routes.ts
 */

import type { Express } from "express";
import Papa from "papaparse";
import { storage } from "../storage";
import { db } from "../db";
import {
  products,
  productOptions,
  productVariants,
  productIntakeSessions,
  productDesignConfigs,
  pbv2TreeVersions,
  pricingFormulas,
  productTypes,
  materials,
  materialProductLinks,
  organizations,
  auditLogs,
  insertProductDesignConfigSchema,
} from "@shared/schema";
import { eq, desc, and, asc, inArray, isNull, sql } from "drizzle-orm";
import { getRequestOrganizationId } from "../tenantContext";
import {
  insertProductSchema,
  updateProductSchema,
  insertProductOptionSchema,
  updateProductOptionSchema,
  insertProductVariantSchema,
  updateProductVariantSchema,
  type InsertProduct,
  type UpdateProduct,
} from "@shared/schema";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { ObjectStorageService } from "../objectStorage";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import type { Finding } from "@shared/pbv2/findings";
import { readPbv2OverrideConfig, writePbv2OverrideConfig } from "../lib/pbv2OverrideConfig";
import { productDesignConfigRepository } from "../storage/productDesignConfig.repo";
import { pbv2ToRuntimeSelectionContext } from "@shared/pbv2/pricingAdapter";
import { collectPbv2WeightMaterialIds } from "../services/pbv2WeightResolver";
import { collectPbv2MaterialValidationIds, validatePbv2MaterialReferences } from "../services/pbv2MaterialValidation";
import { sanitizeLegacyPriceBreaksForPbv2 } from "@shared/pbv2/legacyPriceBreaks";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";
import {
  validatePricingPreviewRequest,
  buildPreviewErrorEnvelope,
  zodIssuesToPreviewDetails,
} from "../services/pricing/pricingPreviewValidation";
import { applyProductTypeIdUpdateGuard } from "../lib/productUpdateGuards";
import { filterProductsForCatalog } from "@shared/productCatalogVisibility";
import { normalizeProductRotationForWrite } from "../lib/productPricingRotationWrite";
import {
  ProductParsingDescriptionGeneratorError,
  productParsingDescriptionGeneratorService,
} from "../services/products/ProductParsingDescriptionGeneratorService";
import { CanonicalProductConfigurationError, canonicalProductConfigurationOperations, takeCanonicalProductConfigurationChanges } from "../services/products/canonicalProductConfigurationOperations";
import { CanonicalPbv2OptionConfigurationError, canonicalPbv2OptionConfigurationOperations } from "../services/products/canonicalPbv2OptionConfigurationOperations";
import { CanonicalProductPricingError, canonicalProductPricingOperations, takeCanonicalProductPricingMetadataChanges } from "../services/products/canonicalProductPricingOperations";
import { CanonicalProductMaterialError, canonicalProductMaterialOperations, canonicalProductMaterialProposalFromTrustedId, takeCanonicalProductMaterialChange, validateCanonicalProductMaterialSelection } from "../services/products/canonicalProductMaterialOperations";
import { CanonicalProductLifecycleError, canonicalProductLifecycleOperations, takeCanonicalProductLifecycleChange } from "../services/products/canonicalProductLifecycleOperations";
import { CanonicalProductPublishError, canonicalProductPublishOperations } from "../services/products/canonicalProductPublishOperations";
import { CanonicalProductPricingEngineConfigurationError, canonicalProductPricingEngineConfigurationOperations, takeCanonicalProductPricingEngineConfigurationChange } from "../services/products/canonicalProductPricingEngineConfigurationOperations";

// ---------------------------------------------------------------------------
// Local JSON typing helpers (do NOT touch shared/schema.ts)
// ---------------------------------------------------------------------------

type BannerOptionKind =
  | "grommets"
  | "sides"
  | "generic"
  | "hems"
  | "pole_pockets"
  | "thickness";

type PriceMode =
  | "flat"
  | "per_qty"
  | "per_sqft"
  | "flat_per_item"
  | "percent_of_base";

type PercentBase = "media" | "line";

interface BaseOptionConfig {
  locations?: Array<"custom" | "all_corners" | "top_corners" | "top_even">;
  defaultLocation?: "custom" | "all_corners" | "top_corners" | "top_even";
  defaultSpacingCount?: number;
  customNotes?: string;
  singleLabel?: string;
  doubleLabel?: string;
  doublePriceMultiplier?: number;
}

type NoKindConfig = BaseOptionConfig & { kind?: undefined };

interface GrommetsConfig extends BaseOptionConfig {
  kind: "grommets";
}

interface GenericConfig extends BaseOptionConfig {
  kind: "generic";
}

interface HemsConfig extends BaseOptionConfig {
  kind: "hems";
  defaultHems?: string;
}

function mergeValidationFindings<T extends { findings: Finding[]; errors: Finding[]; warnings: Finding[]; info: Finding[]; ok: boolean }>(
  validation: T,
  extraFindings: Finding[],
): T {
  const findings = [...validation.findings, ...extraFindings];
  const errors = findings.filter((finding) => finding.severity === "ERROR");
  const warnings = findings.filter((finding) => finding.severity === "WARNING");
  const info = findings.filter((finding) => finding.severity === "INFO");
  return {
    ...validation,
    ok: errors.length === 0,
    findings,
    errors,
    warnings,
    info,
  };
}

async function buildPbv2MaterialValidationFindings(organizationId: string, productId: string, treeJson: unknown): Promise<Finding[]> {
  const [product] = await db
    .select({ primaryMaterialId: products.primaryMaterialId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
    .limit(1);

  const materialIds = collectPbv2MaterialValidationIds({
    treeJson,
    productPrimaryMaterialId: product?.primaryMaterialId ?? null,
  });
  const materialRecords = materialIds.length > 0
    ? await db
        .select({
          id: materials.id,
          name: materials.name,
          sku: materials.sku,
          weightOzPerBasis: materials.weightOzPerBasis,
        })
        .from(materials)
        .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)))
    : [];

  return validatePbv2MaterialReferences({
    treeJson,
    productPrimaryMaterialId: product?.primaryMaterialId ?? null,
    materials: materialRecords,
  });
}

/** Service/Fee is a billing-only workflow intent, never a production default. */
function applyProductWorkflowIntentDefaults(productData: Record<string, any>, existingWorkflowIntent?: string | null) {
  const workflowIntent = String(productData.workflowIntent ?? existingWorkflowIntent ?? "standard_production");
  if (workflowIntent !== "service_fee") return productData;

  return {
    ...productData,
    workflowIntent: "service_fee",
    measurementMode: "quantity_only",
    requiresProductionJob: false,
    requiresProofApproval: false,
  };
}

interface PolePocketsConfig extends BaseOptionConfig {
  kind: "pole_pockets";
  defaultPolePocket?: string;
}

interface ThicknessConfig extends BaseOptionConfig {
  kind: "thickness";
  pricingMode?: "multiplier" | "volume";
  thicknessVariants?: Array<{
    key: string;
    label?: string;
    materialId?: string;
    pricingMode?: "multiplier" | "volume";
    priceMultiplier?: number;
    volumeTiers?: Array<{
      minSheets: number;
      maxSheets?: number | null;
      pricePerSheet: string | number;
    }>;
  }>;
}

interface SidesConfig extends BaseOptionConfig {
  kind: "sides";
  pricingMode?: "multiplier" | "volume";
  volumeTiers?: Array<{
    minSheets: number;
    maxSheets?: number | null;
    singlePricePerSheet: string | number;
    doublePricePerSheet: string | number;
  }>;
}

type OptionConfig =
  | NoKindConfig
  | GenericConfig
  | GrommetsConfig
  | HemsConfig
  | PolePocketsConfig
  | ThicknessConfig
  | SidesConfig;

interface MaterialAddonConfig {
  materialId: string;
  unitType: "sheet" | "sqft" | "linear_ft";
  usageBasis: "same_area" | "same_sheets";
  wasteFactor?: number;
  percentBase?: PercentBase;
}

interface PricingOptionJson {
  id: string;
  label: string;
  type: "select" | "quantity" | "checkbox" | "toggle";
  priceMode: PriceMode;
  amount?: number;
  defaultSelected?: boolean;
  config?: OptionConfig;
  materialAddonConfig?: MaterialAddonConfig;
  percentBase?: PercentBase;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// Helper function to get userId from request user object
// Handles both Replit auth (claims.sub) and local auth (id) formats
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerProductRoutes(
  app: Express,
  {
    isAuthenticated,
    isAdmin,
    isAdminOrOwner,
    requireOrgOwnerAdmin,
    tenantContext,
  }: {
    isAuthenticated: any;
    isAdmin: any;
    isAdminOrOwner: any;
    requireOrgOwnerAdmin: any;
    tenantContext: any;
  }
): void {

  app.get("/api/products", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const activeOnly = String(req.query.activeOnly ?? "").trim().toLowerCase();
      const products = await storage.getAllProducts(organizationId);
      const productIds = products.map((product) => product.id);
      const productTypeIds = Array.from(
        new Set(products.map((product) => product.productTypeId).filter((id): id is string => typeof id === "string" && id.length > 0)),
      );

      const [org] = await db
        .select({ prepressDefaultEnabled: organizations.prepressDefaultEnabled })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      const designConfigs = productIds.length
        ? await db
            .select({
              productId: productDesignConfigs.productId,
              requiresDesign: productDesignConfigs.requiresDesign,
              designBriefRequired: productDesignConfigs.designBriefRequired,
            })
            .from(productDesignConfigs)
            .where(and(eq(productDesignConfigs.organizationId, organizationId), inArray(productDesignConfigs.productId, productIds)))
        : [];

      const typeRows = productTypeIds.length
        ? await db
            .select({
              id: productTypes.id,
              requiresPrepressOverride: productTypes.requiresPrepressOverride,
              sendToProductionDefault: productTypes.sendToProductionDefault,
            })
            .from(productTypes)
            .where(and(eq(productTypes.organizationId, organizationId), inArray(productTypes.id, productTypeIds)))
        : [];

      const materialLinkRows = productIds.length
        ? await db
            .select({
              productId: materialProductLinks.productId,
              materialId: materialProductLinks.materialId,
            })
            .from(materialProductLinks)
            .where(and(
              eq(materialProductLinks.organizationId, organizationId),
              inArray(materialProductLinks.productId, productIds),
              isNull(materialProductLinks.removedAt)
            ))
        : [];

      // A DRAFT is intentionally not sent as order-entry tree data.  The
      // marker lets clients fail visibly rather than mistaking a PBV2 product
      // with no active tree for a legacy $0 product.
      const draftTreeRows = productIds.length
        ? await db
            .select({ productId: pbv2TreeVersions.productId, id: pbv2TreeVersions.id, updatedAt: pbv2TreeVersions.updatedAt })
            .from(pbv2TreeVersions)
            .where(and(
              eq(pbv2TreeVersions.organizationId, organizationId),
              inArray(pbv2TreeVersions.productId, productIds),
              eq(pbv2TreeVersions.status, "DRAFT"),
            ))
            .orderBy(desc(pbv2TreeVersions.updatedAt))
        : [];

      const designByProductId = new Map(designConfigs.map((config) => [config.productId, config] as const));
      const typeById = new Map(typeRows.map((type) => [type.id, type] as const));
      const linkedMaterialIdsByProductId = new Map<string, string[]>();
      for (const row of materialLinkRows) {
        const current = linkedMaterialIdsByProductId.get(row.productId) || [];
        current.push(row.materialId);
        linkedMaterialIdsByProductId.set(row.productId, current);
      }
      const draftTreeIdByProductId = new Map<string, string>();
      for (const row of draftTreeRows) {
        if (!draftTreeIdByProductId.has(row.productId)) draftTreeIdByProductId.set(row.productId, row.id);
      }
      const enrichedProducts = products.map((product) => {
        const designConfig = designByProductId.get(product.id);
        const typeConfig = product.productTypeId ? typeById.get(product.productTypeId) : null;
        const requiresPrepress = typeConfig?.requiresPrepressOverride ?? org?.prepressDefaultEnabled ?? true;
        return {
          ...product,
          requiresDesign: designConfig?.requiresDesign ?? false,
          requiresPrepress,
          productDesignRequiresDesign: designConfig?.requiresDesign ?? false,
          productDesignBriefRequired: designConfig?.designBriefRequired ?? false,
          productTypeRequiresPrepressOverride: typeConfig?.requiresPrepressOverride ?? null,
          productTypeSendToProductionDefault: typeConfig?.sendToProductionDefault ?? false,
          linkedMaterialIds: linkedMaterialIdsByProductId.get(product.id) || [],
          pbv2DraftTreeVersionId: draftTreeIdByProductId.get(product.id) ?? null,
        };
      });
      res.json(
        filterProductsForCatalog(enrichedProducts, {
          activeOnly: activeOnly === "true" || activeOnly === "1",
        }),
      );
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/csv-template", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const templateData = [
        { Type: 'PRODUCT', 'Product Name': 'Business Cards', 'Product Description': 'High-quality business cards', 'Pricing Formula': 'basePrice * quantity', 'Measurement Mode': 'dimensions_required', 'Variant Label': 'Media Type', Category: 'Cards', 'Store URL': 'https://example.com/business-cards', 'Show Store Link': 'true', 'Thumbnail URLs': '', 'Is Active': 'true', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '13oz Vinyl', 'Variant Description': 'Durable vinyl material', 'Base Price Per Sqft': '0.0250', 'Is Default Variant': 'true', 'Variant Display Order': '1', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': 'Mesh', 'Variant Description': 'Windflow mesh material', 'Base Price Per Sqft': '0.0300', 'Is Default Variant': 'false', 'Variant Display Order': '2', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'OPTION', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': 'Lamination', 'Option Description': 'Add protective lamination', 'Option Type': 'toggle', 'Default Value': '', 'Default Selection': 'No Lamination', 'Is Default Enabled': 'false', 'Setup Cost': '25.00', 'Price Formula': 'quantity > 100 ? setupCost : setupCost * 1.5', 'Parent Option Name': '', 'Option Display Order': '1' },
        { Type: 'OPTION', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': 'Grommets', 'Option Description': 'Add metal grommets', 'Option Type': 'select', 'Default Value': '', 'Default Selection': '4 Corners', 'Is Default Enabled': 'false', 'Setup Cost': '0', 'Price Formula': "setupCost + (selection === '4 Corners' ? 10 : selection === '8 Grommets' ? 20 : 0)", 'Parent Option Name': '', 'Option Display Order': '2' },
        { Type: 'OPTION', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': 'Rush Production', 'Option Description': 'Expedited production', 'Option Type': 'toggle', 'Default Value': '', 'Default Selection': 'No Rush', 'Is Default Enabled': 'false', 'Setup Cost': '50.00', 'Price Formula': 'setupCost', 'Parent Option Name': '', 'Option Display Order': '3' },
        { Type: 'PRODUCT', 'Product Name': 'Postcards', 'Product Description': 'Premium postcards', 'Pricing Formula': 'basePrice * quantity * 1.2', 'Variant Label': 'Paper Stock', Category: 'Cards', 'Store URL': 'https://example.com/postcards', 'Show Store Link': 'true', 'Thumbnail URLs': '', 'Is Active': 'true', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Postcards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': 'Glossy', 'Variant Description': 'High gloss finish', 'Base Price Per Sqft': '0.0150', 'Is Default Variant': 'true', 'Variant Display Order': '1', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Postcards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Is Active': '', 'Variant Name': 'Matte', 'Variant Description': 'Matte finish', 'Base Price Per Sqft': '0.0140', 'Is Default Variant': 'false', 'Variant Display Order': '2', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
      ];

      const csv = Papa.unparse(templateData);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.csv"');
      res.send(csv);
    } catch (error) {
      console.error("Error generating CSV template:", error);
      res.status(500).json({ message: "Failed to generate CSV template" });
    }
  });

  app.post("/api/products/import", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const { csvData } = req.body;
      if (!csvData || typeof csvData !== 'string') {
        return res.status(400).json({ message: "CSV data is required" });
      }

      const parseResult = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
      });

      if (parseResult.errors.length > 0) {
        console.error("CSV parsing errors:", parseResult.errors);
        return res.status(400).json({
          message: "CSV parsing failed",
          errors: parseResult.errors.map(e => e.message)
        });
      }

      const rows = parseResult.data as Record<string, string>[];
      if (rows.length === 0) {
        return res.status(400).json({ message: "CSV must contain at least one data row" });
      }

      const productMap: Record<string, string> = {};
      const optionMap: Record<string, Record<string, string>> = {};

      let importedProducts = 0;
      let importedVariants = 0;
      let importedOptions = 0;

      for (const row of rows) {
        const type = row['Type']?.trim();
        const productName = row['Product Name']?.trim();

        if (!type || !productName) continue;

        if (type === 'PRODUCT') {
          const rawMeasurementMode = row['Measurement Mode']?.trim();
          if (rawMeasurementMode && rawMeasurementMode !== 'dimensions_required' && rawMeasurementMode !== 'quantity_only') {
            return res.status(400).json({ message: `Invalid Measurement Mode for product "${productName}"` });
          }
          const thumbnailUrlsRaw = row['Thumbnail URLs']?.trim() || '';
          const thumbnailUrls = thumbnailUrlsRaw
            ? thumbnailUrlsRaw.split('|').map(url => url.trim()).filter(url => url.length > 0)
            : [];

          type InsertProductWithoutOrgId = Omit<InsertProduct, "organizationId">;
          const insertPayload: InsertProductWithoutOrgId = {
            name: productName,
            description: row['Product Description']?.trim() || '',
            aiParsingDescription: null,
            aiParsingDescriptionLinkedToDescription: false,
            pricingProfileKey: "default",
            pricingMode: "area",
            measurementMode: rawMeasurementMode === "quantity_only" ? "quantity_only" : "dimensions_required",
            workflowIntent: "standard_production",
            allowZeroPrice: false,
            isService: false,
            artworkPolicy: "not_required",
            requiresProductionJob: true,
            pricingFormula: row['Pricing Formula']?.trim() || 'basePrice * quantity',
            variantLabel: row['Variant Label']?.trim(),
            category: row['Category']?.trim(),
            storeUrl: row['Store URL']?.trim(),
            showStoreLink: row['Show Store Link']?.trim().toLowerCase() === 'true',
            thumbnailUrls,
            isActive: row['Is Active']?.trim().toLowerCase() !== 'false',
          };

          const newProduct = await storage.createProduct(organizationId, insertPayload);
          productMap[productName] = newProduct.id;
          importedProducts++;
        } else if (type === 'VARIANT') {
          const productId = productMap[productName];
          if (!productId) {
            console.warn(`Variant references unknown product: ${productName}`);
            continue;
          }

          await storage.createProductVariant({
            productId,
            name: row['Variant Name']?.trim() || '',
            description: row['Variant Description']?.trim() || null,
            basePricePerSqft: parseFloat(row['Base Price Per Sqft']?.trim() || '0'),
            isDefault: row['Is Default Variant']?.trim().toLowerCase() === 'true',
            displayOrder: parseInt(row['Variant Display Order']?.trim() || '0'),
          });
          importedVariants++;
        } else if (type === 'OPTION') {
          const productId = productMap[productName];
          if (!productId) {
            console.warn(`Option references unknown product: ${productName}`);
            continue;
          }

          if (!optionMap[productName]) {
            optionMap[productName] = {};
          }

          const optionName = row['Option Name']?.trim();
          const parentOptionName = row['Parent Option Name']?.trim();
          let parentOptionId = null;

          if (parentOptionName && optionMap[productName][parentOptionName]) {
            parentOptionId = optionMap[productName][parentOptionName];
          }

          const newOption = await storage.createProductOption({
            productId,
            name: optionName || '',
            description: row['Option Description']?.trim() || null,
            type: row['Option Type']?.trim() as 'toggle' | 'number' | 'select' || 'toggle',
            defaultValue: row['Default Value']?.trim() || null,
            defaultSelection: row['Default Selection']?.trim() || null,
            isDefaultEnabled: row['Is Default Enabled']?.trim().toLowerCase() === 'true',
            setupCost: parseFloat(row['Setup Cost']?.trim() || '0'),
            priceFormula: row['Price Formula']?.trim() || null,
            parentOptionId,
            displayOrder: parseInt(row['Option Display Order']?.trim() || '0'),
          });

          if (optionName) {
            optionMap[productName][optionName] = newOption.id;
          }
          importedOptions++;
        }
      }

      res.json({
        message: "Products imported successfully",
        imported: {
          products: importedProducts,
          variants: importedVariants,
          options: importedOptions,
        }
      });
    } catch (error) {
      console.error("Error importing products:", error);
      res.status(500).json({ message: "Failed to import products" });
    }
  });

  // ============================================================================
  // PBV2-Aware Product Import/Export (v2)
  // ============================================================================

  /**
   * GET /api/admin/products/export
   * Export all products with full PBV2 tree definitions
   * Org-scoped, admin-only
   */
  app.get("/api/admin/products/export", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const { exportProducts } = await import("../services/pbv2ExportMapper");

      const requestedProductIds = String(req.query.productIds ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (req.query.productIds !== undefined && requestedProductIds.length === 0) {
        return res.status(400).json({ error: "At least one product must be selected for export" });
      }

      // Fetch selected products for org, or all products when no selection is supplied.
      const allProducts = await db
        .select()
        .from(products)
        .where(
          requestedProductIds.length > 0
            ? and(eq(products.organizationId, organizationId), inArray(products.id, requestedProductIds))
            : eq(products.organizationId, organizationId)
        )
        .orderBy(asc(products.name));

      if (requestedProductIds.length > 0 && allProducts.length === 0) {
        return res.status(404).json({ error: "No selected products were found for this organization" });
      }

      // Fetch all PBV2 trees for these products
      const productIds = allProducts.map(p => p.id);
      const pbv2Trees = new Map<string, { active?: any; draft?: any }>();

      if (productIds.length > 0) {
        const allTreeVersions = await db
          .select()
          .from(pbv2TreeVersions)
          .where(
            and(
              eq(pbv2TreeVersions.organizationId, organizationId),
              inArray(pbv2TreeVersions.productId, productIds)
            )
          );

        for (const tree of allTreeVersions) {
          if (!pbv2Trees.has(tree.productId)) {
            pbv2Trees.set(tree.productId, {});
          }
          const entry = pbv2Trees.get(tree.productId)!;
          if (tree.status === "ACTIVE") entry.active = tree;
          if (tree.status === "DRAFT") entry.draft = tree;
        }
      }

      // Fetch reference data
      const [allProductTypes, allMaterials, allPricingFormulas, org] = await Promise.all([
        db.select().from(productTypes).where(eq(productTypes.organizationId, organizationId)),
        db.select().from(materials).where(eq(materials.organizationId, organizationId)),
        db.select().from(pricingFormulas).where(eq(pricingFormulas.organizationId, organizationId)),
        db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
      ]);

      const exportData = await exportProducts(
        {
          db,
          organizationId,
          orgName: org[0]?.name,
        },
        allProducts,
        pbv2Trees,
        allProductTypes,
        allMaterials,
        allPricingFormulas,
      );

      // Audit log
      await db.insert(auditLogs).values({
        organizationId,
        userId: userId || null,
        actionType: "EXPORT",
        entityType: "product",
        entityId: null,
        description: `Exported ${exportData.products.length} products`,
        newValues: { count: exportData.products.length },
      });

      res.json(exportData);
    } catch (error: any) {
      console.error("[Product Export] Error:", error);
      res.status(500).json({
        error: error.message || "Failed to export products",
        ...(error.code ? { code: error.code } : {}),
        ...(error.metadata ? { metadata: error.metadata } : {}),
      });
    }
  });

  /**
   * POST /api/admin/products/import?dryRun=1|0
   * Import products with PBV2 trees
   * Org-scoped, admin-only
   */
  app.post("/api/admin/products/import", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
      const mode = (req.body.mode || "upsertBySlug") as any;

      const { productImportV2RequestSchema } = await import("@shared/importExportSchemas");
      const { buildImportPlan, applyImport } = await import("../services/pbv2ImportMapper");

      // Validate request body
      const validation = productImportV2RequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid import request",
          details: validation.error.errors,
        });
      }

      const importRequest = validation.data;

      if (!userId) {
        return res.status(403).json({ error: "User ID required" });
      }

      const ctx = {
        db,
        organizationId,
        userId,
        mode,
      };

      if (dryRun) {
        // Dry-run: validate and return plan
        const plan = await buildImportPlan(ctx, importRequest);

        // Audit log
        await db.insert(auditLogs).values({
          organizationId,
          userId,
          actionType: "VALIDATE",
          entityType: "product",
          entityId: null,
          description: `Dry-run validation: ${plan.counts.total} products, ${plan.errors.length} errors`,
          newValues: {
            total: plan.counts.total,
            create: plan.counts.create,
            update: plan.counts.update,
            skip: plan.counts.skip,
            errorCount: plan.errors.length,
          },
        });

        res.json(plan);
      } else {
        // Apply import
        const result = await applyImport(ctx, importRequest);

        // Audit log
        await db.insert(auditLogs).values({
          organizationId,
          userId,
          actionType: "IMPORT",
          entityType: "product",
          entityId: null,
          description: `Imported products: ${result.counts.created} created, ${result.counts.updated} updated, ${result.counts.failed} failed`,
          newValues: {
            total: result.counts.total,
            created: result.counts.created,
            updated: result.counts.updated,
            skipped: result.counts.skipped,
            failed: result.counts.failed,
          },
        });

        res.json(result);
      }
    } catch (error: any) {
      console.error("[Product Import] Error:", error);
      res.status(500).json({ error: error.message || "Failed to import products" });
    }
  });


  // ============================================================================
  // PBV2 (Product Builder v2) - Versioned Tree Lifecycle
  // ============================================================================

  app.get("/api/products/:productId/pbv2/tree", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;
      const requestedDraftTreeVersionId = typeof req.query?.draftTreeVersionId === "string" && req.query.draftTreeVersionId.trim()
        ? req.query.draftTreeVersionId.trim()
        : null;

      // Verify product exists
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      // Read DRAFT from pbv2_tree_versions table
      let draft: typeof pbv2TreeVersions.$inferSelect | null;
      if (requestedDraftTreeVersionId) {
        const [requestedDraft] = await db
          .select()
          .from(pbv2TreeVersions)
          .where(and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.id, requestedDraftTreeVersionId),
            eq(pbv2TreeVersions.status, "DRAFT")
          ))
          .limit(1);
        draft = requestedDraft ?? null;
      } else {
        // The AI pricing read uses this same resolver for every product,
        // preventing the editor and AI from disagreeing about current PBV2 DRAFT
        // availability.
        const { loadCurrentPbv2DraftTreeVersion } = await import("../services/pricing/PricingService");
        draft = await loadCurrentPbv2DraftTreeVersion({ organizationId, productId });
      }
      if (requestedDraftTreeVersionId && !draft) {
        return res.status(404).json({
          success: false,
          message: "Requested PBV2 draft tree was not found for this product.",
          errorCode: "PBV2_DRAFT_TREE_NOT_FOUND",
        });
      }

      // Read ACTIVE tree using products.pbv2ActiveTreeVersionId
      let active = null;
      const [productWithActiveId] = await db
        .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (productWithActiveId?.pbv2ActiveTreeVersionId) {
        const [activeVersion] = await db
          .select()
          .from(pbv2TreeVersions)
          .where(
            and(
              eq(pbv2TreeVersions.organizationId, organizationId),
              eq(pbv2TreeVersions.id, productWithActiveId.pbv2ActiveTreeVersionId)
            )
          )
          .limit(1);
        active = activeVersion || null;
      }

      // LOG: What we found
      console.log('[PBV2_TREE_GET] rows found', {
        orgId: organizationId,
        productId,
        draftFound: !!draft,
        draftId: draft?.id || null,
        requestedDraftTreeVersionId,
        activeFound: !!active,
        activeId: active?.id || null,
      });

      // DEV-ONLY: Log details
      if (process.env.NODE_ENV !== 'production') {
        if (draft) {
          const nodeCount = typeof draft.treeJson === 'object' && draft.treeJson ? Object.keys((draft.treeJson as any).nodes || {}).length : 0;
          const rootCount = Array.isArray((draft.treeJson as any).rootNodeIds) ? (draft.treeJson as any).rootNodeIds.length : 0;
          console.log(`[GET /api/products/${productId}/pbv2/tree] DRAFT:`, {
            draftId: draft.id,
            nodeCount,
            rootCount,
            schemaVersion: (draft.treeJson as any)?.schemaVersion,
          });
        } else {
          console.log(`[GET /api/products/${productId}/pbv2/tree] No DRAFT found`);
        }
        if (active) {
          const nodeCount = typeof active.treeJson === 'object' && active.treeJson ? Object.keys((active.treeJson as any).nodes || {}).length : 0;
          const rootCount = Array.isArray((active.treeJson as any).rootNodeIds) ? (active.treeJson as any).rootNodeIds.length : 0;
          console.log(`[GET /api/products/${productId}/pbv2/tree] ACTIVE:`, {
            activeId: active.id,
            nodeCount,
            rootCount,
            schemaVersion: (active.treeJson as any)?.schemaVersion,
            hasPricingV2: !!(active.treeJson as any)?.meta?.pricingV2,
          });
        } else {
          console.log(`[GET /api/products/${productId}/pbv2/tree] No ACTIVE found`);
        }
      }

      return res.json({ success: true, data: { draft: draft || null, active: active || null } });
    } catch (error: any) {
      console.error("Error fetching PBV2 tree:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch PBV2 tree" });
    }
  });

  app.put("/api/products/:productId/pbv2/draft", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      const { productId } = req.params;

      // LOG 1: Handler hit
      console.log('[PBV2_DRAFT_PUT] hit', {
        productId,
        orgId: organizationId,
        userId,
        timestamp: new Date().toISOString()
      });

      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const treeJson = (req.body as any)?.treeJson;

      if (!treeJson || typeof treeJson !== "object" || Array.isArray(treeJson)) {
        console.log('[PBV2_DRAFT_PUT] validation failed: treeJson invalid');
        return res.status(400).json({ success: false, message: "treeJson must be an object" });
      }

      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        console.log('[PBV2_DRAFT_PUT] product not found');
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      // LOG 2: Tree stats (client should have set rootNodeIds via ensureRootNodeIds)
      const nodes = (treeJson as any).nodes || {};
      const nodeCount = Object.keys(nodes).length;
      const edgeCount = Array.isArray((treeJson as any).edges) ? (treeJson as any).edges.length : 0;
      const rootCountBefore = Array.isArray((treeJson as any).rootNodeIds) ? (treeJson as any).rootNodeIds.length : 0;
      const schemaVersion = (treeJson as any).schemaVersion ?? 2;

      // DEFENSIVE: Warn if rootNodeIds is empty but nodes exist (should be fixed client-side)
      if (nodeCount > 0 && rootCountBefore === 0) {
        console.warn('[PBV2_DRAFT_PUT] âš ï¸ rootNodeIds is empty but tree has nodes - client should call ensureRootNodeIds', {
          nodeCount,
          edgeCount,
          schemaVersion,
        });
      } else {
        console.log('[PBV2_DRAFT_PUT] incoming tree stats', {
          schemaVersion,
          nodeCount,
          edgeCount,
          rootCount: rootCountBefore,
          rootNodeIds: (treeJson as any).rootNodeIds,
        });
      }

      // Count nodes by type to detect missing options/pricing
      const nodesByType: Record<string, number> = {};
      const nodesByKind: Record<string, number> = {};
      for (const node of Object.values(nodes) as any[]) {
        const nodeType = (node?.type || 'UNKNOWN').toUpperCase();
        const nodeKind = node?.kind || 'unknown';
        nodesByType[nodeType] = (nodesByType[nodeType] || 0) + 1;
        nodesByKind[nodeKind] = (nodesByKind[nodeKind] || 0) + 1;
      }
      const firstFiveNodeKeys = Object.keys(nodes).slice(0, 5);
      console.log('[PBV2_DRAFT_PUT] node breakdown', {
        nodesByType,
        nodesByKind,
        firstFiveNodeKeys,
      });

      // Phase 6: the Product Editor keeps its full-tree save contract, while
      // option validation and DRAFT persistence are owned by the same
      // transport-independent operation used by confirmed AI edits.
      if (!userId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
      const canonicalSave = await canonicalPbv2OptionConfigurationOperations.saveEditorDraft({ organizationId, actorUserId: userId, productId, treeJson });
      const draft = canonicalSave.draft;
      if (canonicalSave.sanitizerChanges.length > 0) {
        console.warn('[PBV2_MATRIX_SANITIZER] draft save removed stale matrix references', { productId, orgId: organizationId, changes: canonicalSave.sanitizerChanges });
      }

      // ============================================================
      // AUTO-ACTIVATION: If org mode is 'auto_on_save', attempt activation
      // ============================================================
      let activationAttempted = false;
      let activationResult: {
        success: boolean;
        activated?: boolean;
        findings?: any[];
        errorCode?: string;
        message?: string;
      } = { success: false };

      // Load org to check activation mode
      const [org] = await db
        .select({ pbv2ActivationMode: organizations.pbv2ActivationMode })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      const [linkedProductIntakeDraft] = await db
        .select({
          sessionId: productIntakeSessions.id,
          createdPbv2TreeVersionId: productIntakeSessions.createdPbv2TreeVersionId,
        })
        .from(productIntakeSessions)
        .where(and(
          eq(productIntakeSessions.organizationId, organizationId),
          eq(productIntakeSessions.createdProductId, productId),
          eq(productIntakeSessions.status, "draft_created"),
        ))
        .limit(1);

      if (linkedProductIntakeDraft) {
        console.log('[PBV2_AUTO_ACTIVATE] skipped for Product Intake draft', {
          productId,
          sessionId: linkedProductIntakeDraft.sessionId,
          createdPbv2TreeVersionId: linkedProductIntakeDraft.createdPbv2TreeVersionId,
        });
      } else if (org?.pbv2ActivationMode === 'auto_on_save') {
        activationAttempted = true;
        console.log('[PBV2_AUTO_ACTIVATE] attempting auto-activation', { draftId: draft.id, productId, orgId: organizationId });

        try {
          // GUARDRAIL 1: Check schemaVersion = 2
          const treeJson = (draft as any).treeJson as any;
          const schemaVersion = treeJson?.schemaVersion ?? 1;
          if (schemaVersion !== 2) {
            activationResult = {
              success: false,
              activated: false,
              errorCode: 'PBV2_E_SCHEMA_VERSION_UNSUPPORTED',
              message: 'Draft saved but not activated: tree must be upgraded to PBV2 v2',
              findings: [{
                severity: "error",
                message: "Tree schemaVersion must be 2 for activation",
                path: "schemaVersion",
                actual: schemaVersion,
                expected: 2,
              }],
            };
            console.log('[PBV2_AUTO_ACTIVATE] blocked by schemaVersion', { draftId: draft.id, schemaVersion });
          } else {
          // GUARDRAIL 2: Run same validations as publish
          const { validateTreeHasBasePrice } = await import("../../shared/pbv2/validator/validateBasePrice");
          const basePriceValidation = validateTreeHasBasePrice(treeJson);

          if (basePriceValidation.errors.length > 0) {
            activationResult = {
              success: false,
              activated: false,
              errorCode: 'BASE_PRICE_MISSING',
              message: 'Draft saved but not activated: base pricing required',
              findings: basePriceValidation.findings,
            };
            console.log('[PBV2_AUTO_ACTIVATE] blocked by base pricing validation', { draftId: draft.id });
          } else {
            const { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } = await import("../../shared/pbv2/validator");
            const publishValidation = mergeValidationFindings(
              validateTreeForPublish((draft as any).treeJson as any, DEFAULT_VALIDATE_OPTS),
              await buildPbv2MaterialValidationFindings(organizationId, productId, (draft as any).treeJson as any),
            );

            if (publishValidation.errors.length > 0) {
              activationResult = {
                success: false,
                activated: false,
                errorCode: 'VALIDATION_ERRORS',
                message: 'Draft saved but not activated: validation errors present',
                findings: publishValidation.findings,
              };
              console.log('[PBV2_AUTO_ACTIVATE] blocked by publish validation', { draftId: draft.id, errorCount: publishValidation.errors.length });
            } else {
              // Validation passed, activate the tree
              const publishedAt = new Date();

              await db.transaction(async (tx) => {
                // Check for previous active version
                const [productRecord] = await tx
                  .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
                  .from(products)
                  .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
                  .limit(1);

                const previousActiveId = productRecord?.pbv2ActiveTreeVersionId;

                // Deprecate previous active if different
                if (previousActiveId && previousActiveId !== draft.id) {
                  await tx
                    .update(pbv2TreeVersions)
                    .set({ status: "DEPRECATED", updatedAt: publishedAt, updatedByUserId: userId ?? null })
                    .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, previousActiveId)));
                }

                // Activate this version
                const nextTreeJson = {
                  ...(draft as any).treeJson,
                  schemaVersion: 2, // Preserve v2 schema
                  status: "ACTIVE",
                };

                await tx
                  .update(pbv2TreeVersions)
                  .set({
                    status: "ACTIVE",
                    publishedAt,
                    updatedAt: publishedAt,
                    updatedByUserId: userId ?? null,
                    treeJson: nextTreeJson,
                  })
                  .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, draft.id)));

                // Update product pointer AND sync optionTreeJson for client-side rendering
                await tx
                  .update(products)
                  .set({ pbv2ActiveTreeVersionId: draft.id, optionTreeJson: nextTreeJson, updatedAt: publishedAt })
                  .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)));
              });

              activationResult = {
                success: true,
                activated: true,
                message: 'Draft saved and activated successfully',
                findings: publishValidation.warnings.length > 0 ? publishValidation.findings : undefined,
              };
              console.log('[PBV2_AUTO_ACTIVATE] activation succeeded', { draftId: draft.id, productId, pbv2ActiveTreeVersionId: draft.id });
            }
          }
          }
        } catch (activationError: any) {
          // Don't fail the save if activation fails
          activationResult = {
            success: false,
            activated: false,
            errorCode: 'ACTIVATION_FAILED',
            message: 'Draft saved but activation failed: ' + (activationError.message || 'Unknown error'),
          };
          console.error('[PBV2_AUTO_ACTIVATE] activation failed', { draftId: draft.id, error: activationError });
        }
      }

      return res.json({
        success: true,
        data: draft,
        activationAttempted,
        activationResult: activationAttempted ? activationResult : undefined,
      });
    } catch (error: any) {
      if (error instanceof CanonicalPbv2OptionConfigurationError) {
        const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "PBV2_DRAFT_STALE" ? 409 : error.code === "ACTOR_REQUIRED" ? 401 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message, findings: error.findings });
      }
      console.error('[PBV2_DRAFT_PUT] FATAL ERROR:', error);
      console.error('[PBV2_DRAFT_PUT] error stack:', error.stack);
      return res.status(500).json({ success: false, message: "Failed to upsert PBV2 draft", error: error.message });
    }
  });


  app.post("/api/pbv2/tree-versions/:id/publish", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = req.params;
      const confirmWarnings = String((req.query as any)?.confirmWarnings ?? "").toLowerCase() === "true";
      const activateProduct = (req.body as any)?.activateProduct === true;
      const userId = getUserId(req.user);

      if (!userId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
      const proposal = await canonicalProductPublishOperations.propose({ organizationId, treeVersionId: id });
      if (proposal.warnings.length && !confirmWarnings) return res.json({ success: true, requiresWarningsConfirm: true, findings: proposal.warnings });
      const result = await canonicalProductPublishOperations.execute({ organizationId, actorUserId: userId, productId: proposal.productId, treeVersionId: proposal.treeVersionId, expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt, confirmWarnings, activateProduct, auditContext: { source: "product_editor", reference: `route:POST:/api/pbv2/tree-versions/${id}/publish` } });
      return res.json({ success: true, data: result.tree, product: result.product, productId: result.product.id, pbv2ActiveTreeVersionId: result.tree.id, findings: proposal.warnings, ...(proposal.alreadyPublished ? { message: "Tree version already published and active" } : {}) });
    } catch (error: any) {
      if (error instanceof CanonicalProductPublishError) { const status = error.code === "PRODUCT_PUBLISH_TARGET_NOT_FOUND" ? 404 : error.code === "PBV2_PUBLISH_STALE" || error.code === "PBV2_DRAFT_REQUIRED" ? 409 : 400; return res.status(status).json({ success: false, code: error.code, message: error.message, findings: error.findings }); }
      console.error("Error publishing PBV2 tree version:", error);
      return res.status(500).json({ success: false, message: "Failed to publish PBV2 tree version" });
    }
  });

  // ============================================================================
  // PBV2 Advanced Override (Admin-only, temporary)
  // - Stores pointer in products.pricingProfileConfig.pbv2Override
  // - Stores override tree JSON in pbv2_tree_versions (status=ARCHIVED)
  // - Evaluation uses override when enabled (see orders.routes.ts)
  // ============================================================================

  app.get("/api/products/:productId/pbv2/override", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const cfg = readPbv2OverrideConfig((product as any).pricingProfileConfig);

      let treeJson: any = null;
      if (cfg.treeVersionId) {
        const [tv] = await db
          .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
          .from(pbv2TreeVersions)
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, cfg.treeVersionId)))
          .limit(1);
        treeJson = tv?.treeJson ?? null;
      }

      return res.json({
        success: true,
        data: {
          enabled: cfg.enabled,
          treeVersionId: cfg.treeVersionId,
          treeJsonText: treeJson ? JSON.stringify(treeJson, null, 2) : "",
        },
      });
    } catch (error: any) {
      console.error("Error fetching PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/validate", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const treeJsonText = String((req.body as any)?.treeJsonText ?? "");
      let parsed: any;
      try {
        parsed = JSON.parse(treeJsonText);
      } catch (e: any) {
        return res.status(400).json({
          success: false,
          message: `Override JSON invalid: ${e?.message ?? "Invalid JSON"}`,
          findings: [
            {
              severity: "ERROR",
              code: "PBV2_E_OVERRIDE_JSON_PARSE",
              message: `Invalid JSON: ${e?.message ?? "parse error"}`,
              path: "override.treeJsonText",
            },
          ],
        });
      }

      const validation = validateTreeForPublish(parsed as any, DEFAULT_VALIDATE_OPTS);
      const ok = validation.errors.length === 0;

      return res.json({
        success: ok,
        message: ok ? "Override JSON is publish-valid" : "Override JSON blocked by validation errors",
        findings: validation.findings,
      });
    } catch (error: any) {
      console.error("Error validating PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to validate PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/save", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;
      const userId = getUserId(req.user);

      const treeJsonText = String((req.body as any)?.treeJsonText ?? "");
      const enable = Boolean((req.body as any)?.enable);

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      let parsed: any;
      try {
        parsed = JSON.parse(treeJsonText);
      } catch (e: any) {
        return res.status(400).json({
          success: false,
          message: `Override JSON invalid: ${e?.message ?? "Invalid JSON"}`,
          findings: [
            {
              severity: "ERROR",
              code: "PBV2_E_OVERRIDE_JSON_PARSE",
              message: `Invalid JSON: ${e?.message ?? "parse error"}`,
              path: "override.treeJsonText",
            },
          ],
        });
      }

      const validation = validateTreeForPublish(parsed as any, DEFAULT_VALIDATE_OPTS);
      if (validation.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Override JSON blocked by validation errors",
          findings: validation.findings,
        });
      }

      const cfg = readPbv2OverrideConfig((product as any).pricingProfileConfig);

      const saved = await db.transaction(async (tx) => {
        let treeVersionId = cfg.treeVersionId;

        if (treeVersionId) {
          const [existingTv] = await tx
            .select({ id: pbv2TreeVersions.id })
            .from(pbv2TreeVersions)
            .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, treeVersionId)))
            .limit(1);
          if (!existingTv) treeVersionId = null;
        }

        if (treeVersionId) {
          await tx
            .update(pbv2TreeVersions)
            .set({
              status: "ARCHIVED",
              treeJson: parsed,
              updatedAt: new Date(),
              updatedByUserId: userId ?? null,
            })
            .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, treeVersionId)));
        } else {
          const [inserted] = await tx
            .insert(pbv2TreeVersions)
            .values({
              organizationId,
              productId,
              status: "ARCHIVED",
              schemaVersion: 1,
              treeJson: parsed,
              createdByUserId: userId ?? null,
              updatedByUserId: userId ?? null,
            })
            .returning({ id: pbv2TreeVersions.id });
          treeVersionId = inserted?.id ? String(inserted.id) : null;
        }

        const nextConfig = writePbv2OverrideConfig((product as any).pricingProfileConfig, {
          treeVersionId,
          enabled: enable,
        });

        await tx
          .update(products)
          .set({ pricingProfileConfig: nextConfig, updatedAt: new Date() })
          .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

        return { treeVersionId, enabled: enable };
      });

      return res.json({
        success: true,
        message: saved.enabled ? "PBV2 override saved and enabled" : "PBV2 override saved",
        data: saved,
        findings: validation.findings,
      });
    } catch (error: any) {
      console.error("Error saving PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to save PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/toggle", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;
      const enabled = Boolean((req.body as any)?.enabled);

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const cfg = readPbv2OverrideConfig((product as any).pricingProfileConfig);
      if (enabled) {
        if (!cfg.treeVersionId) {
          return res.status(409).json({ success: false, message: "Cannot enable override: no override JSON has been saved yet" });
        }

        const [tv] = await db
          .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
          .from(pbv2TreeVersions)
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, cfg.treeVersionId)))
          .limit(1);

        if (!tv) {
          return res.status(409).json({ success: false, message: "Cannot enable override: override tree version not found" });
        }

        const validation = validateTreeForPublish((tv as any).treeJson as any, DEFAULT_VALIDATE_OPTS);
        if (validation.errors.length > 0) {
          return res.status(400).json({
            success: false,
            message: "Cannot enable override: stored override JSON is not publish-valid",
            findings: validation.findings,
          });
        }
      }

      const nextConfig = writePbv2OverrideConfig((product as any).pricingProfileConfig, { enabled });
      await db
        .update(products)
        .set({ pricingProfileConfig: nextConfig, updatedAt: new Date() })
        .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

      return res.json({ success: true, message: enabled ? "PBV2 override enabled" : "PBV2 override disabled", data: { enabled } });
    } catch (error: any) {
      console.error("Error toggling PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to toggle PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/disable", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const nextConfig = writePbv2OverrideConfig((product as any).pricingProfileConfig, { enabled: false });
      await db
        .update(products)
        .set({ pricingProfileConfig: nextConfig, updatedAt: new Date() })
        .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

      return res.json({ success: true, message: "PBV2 override disabled (JSON kept)", data: { enabled: false } });
    } catch (error: any) {
      console.error("Error disabling PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to disable PBV2 override" });
    }
  });

  // ============================================================================
  // PBV2 Pricing Preview
  // ============================================================================

  app.get("/api/pbv2/pricing-preview/variables", isAuthenticated, tenantContext, async (_req: any, res) => {
    try {
      const { getPbv2PricingVariableDefinitions } = await import("../services/pricing/PricingService");
      return res.json({
        success: true,
        data: getPbv2PricingVariableDefinitions(),
      });
    } catch {
      return res.status(500).json({ message: "Failed to load pricing variables" });
    }
  });

  app.get("/api/pbv2/pricing-preview/reference", isAuthenticated, tenantContext, async (_req: any, res) => {
    try {
      const { getPbv2PricingVariableDefinitions } = await import("../services/pricing/PricingService");
      const { PBV2_PRICING_FUNCTIONS } = await import("../../shared/pbv2/pricingFunctionCatalog");
      return res.json({
        success: true,
        data: {
          supportedVariables: getPbv2PricingVariableDefinitions(),
          supportedFunctions: PBV2_PRICING_FUNCTIONS,
        },
      });
    } catch {
      return res.status(500).json({ message: "Failed to load formula reference" });
    }
  });

  app.get("/api/pbv2/pricing-preview", isAuthenticated, tenantContext, async (_req: any, res) => {
    return res.status(405).json({
      message: "Method Not Allowed",
      allowedMethods: ["POST"],
    });
  });

  app.post("/api/pbv2/pricing-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const {
        pricingFormulaOverride,
        manualFormulaText,
        pricingFormulaId,
        formulaSourceMode,
        pricingProfileKey,
        pricingProfileConfig,
        formulaVariables,
        productPrimaryMaterialId,
        debug,
      } = req.body ?? {};

      // Validate + normalize the (TEMP, editor-only) preview payload. On rejection
      // we return a structured envelope so the sandbox can show actionable detail.
      const validation = validatePricingPreviewRequest(req.body ?? {});
      if (!validation.ok) {
        return res.status(validation.status).json(validation.envelope);
      }
      const { treeJson, widthNum, heightNum, quantityNum, pbv2ExplicitSelections, measurementMode } = validation.normalized;
      const normalizedFormulaSourceMode = typeof formulaSourceMode === "string" && formulaSourceMode.trim()
        ? formulaSourceMode.trim()
        : undefined;
      const sourceModeIsLibrary = normalizedFormulaSourceMode === "library" || normalizedFormulaSourceMode === "formulaLibrary";
      const overrideFormula = !sourceModeIsLibrary && typeof pricingFormulaOverride === "string" && pricingFormulaOverride.trim()
        ? pricingFormulaOverride
        : undefined;
      let pricingFormulaLibrary: { id: string; name?: string | null; code?: string | null; expression: string; config?: Record<string, any> | null } | undefined;
      const normalizedPricingFormulaId = typeof pricingFormulaId === "string" && pricingFormulaId.trim()
        ? pricingFormulaId.trim()
        : "";
      if (normalizedPricingFormulaId) {
        const [formula] = await db
          .select({
            id: pricingFormulas.id,
            name: pricingFormulas.name,
            code: pricingFormulas.code,
            expression: pricingFormulas.expression,
            config: pricingFormulas.config,
          })
          .from(pricingFormulas)
          .where(and(eq(pricingFormulas.id, normalizedPricingFormulaId), eq(pricingFormulas.organizationId, organizationId)))
          .limit(1);
        if (typeof formula?.expression === "string" && formula.expression.trim()) {
          pricingFormulaLibrary = { id: formula.id, name: formula.name, code: formula.code, expression: formula.expression, config: formula.config as any };
        } else {
          return res.json({
            success: false,
            message: "Formula Library selection could not be resolved",
            errors: [{
              code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
              message: `Selected Formula Library item '${normalizedPricingFormulaId}' could not be resolved.`,
            }],
            debug: {
              pricingSystem: "pbv2",
              formulaRaw: "",
              variables: {},
              formulaSourceMode: "library",
              resolvedFormulaSource: "none",
              resolvedFormulaId: normalizedPricingFormulaId,
              resolvedFormulaName: null,
              resolvedFormulaExpression: "",
              manualFormulaPresent: (
                (typeof pricingFormulaOverride === "string" && pricingFormulaOverride.trim().length > 0) ||
                (typeof manualFormulaText === "string" && manualFormulaText.trim().length > 0)
              ),
              manualFormulaIgnored: (
                (typeof pricingFormulaOverride === "string" && pricingFormulaOverride.trim().length > 0) ||
                (typeof manualFormulaText === "string" && manualFormulaText.trim().length > 0)
              ),
              errors: [{
                code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
                message: `Selected Formula Library item '${normalizedPricingFormulaId}' could not be resolved.`,
              }],
            },
          });
        }
      } else if (sourceModeIsLibrary) {
        return res.json({
          success: false,
          message: "Formula Library mode is selected, but no Formula Library item is selected",
          errors: [{
            code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
            message: "Formula Library mode is selected, but no Formula Library item is selected.",
          }],
          debug: {
            pricingSystem: "pbv2",
            formulaRaw: "",
            variables: {},
            formulaSourceMode: "library",
            resolvedFormulaSource: "none",
            resolvedFormulaId: null,
            resolvedFormulaName: null,
            resolvedFormulaExpression: "",
            manualFormulaPresent: (
              (typeof pricingFormulaOverride === "string" && pricingFormulaOverride.trim().length > 0) ||
              (typeof manualFormulaText === "string" && manualFormulaText.trim().length > 0)
            ),
            manualFormulaIgnored: (
              (typeof pricingFormulaOverride === "string" && pricingFormulaOverride.trim().length > 0) ||
              (typeof manualFormulaText === "string" && manualFormulaText.trim().length > 0)
            ),
            errors: [{
              code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
              message: "Formula Library mode is selected, but no Formula Library item is selected.",
            }],
          },
        });
      }

      const { evaluatePricingPreviewFromTree } = await import("../services/pricing/PricingService");
      const normalizedPrimaryMaterialId = typeof productPrimaryMaterialId === "string" && productPrimaryMaterialId.trim()
        ? productPrimaryMaterialId.trim()
        : null;
      let materialRecords: any[] = [];
      if (debug) {
        const runtimeSelectionContext = pbv2ToRuntimeSelectionContext(treeJson, pbv2ExplicitSelections, {
          widthIn: widthNum,
          heightIn: heightNum,
          quantity: quantityNum,
          sqft: (widthNum * heightNum) / 144,
        });
        const materialIds = collectPbv2WeightMaterialIds({
          runtimeSelectionContext,
          productPrimaryMaterialId: normalizedPrimaryMaterialId,
        });
        if (materialIds.length > 0) {
          materialRecords = await db
            .select()
            .from(materials)
            .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)));
        }
      }

      const result = evaluatePricingPreviewFromTree({
        treeJson,
        widthIn: widthNum,
        heightIn: heightNum,
        quantity: quantityNum,
        pbv2ExplicitSelections,
        pricingFormulaOverride: overrideFormula,
        manualFormulaText: typeof manualFormulaText === "string" ? manualFormulaText : undefined,
        formulaSourceMode: normalizedFormulaSourceMode as any,
        pricingFormulaLibrary,
        pricingProfileKey: typeof pricingProfileKey === "string" ? pricingProfileKey : undefined,
        pricingProfileConfig: pricingProfileConfig ?? undefined,
        measurementMode,
        formulaVariables: formulaVariables && typeof formulaVariables === "object" && !Array.isArray(formulaVariables)
          ? formulaVariables as Record<string, number>
          : undefined,
        productPrimaryMaterialId: normalizedPrimaryMaterialId,
        materialRecords,
        debug: Boolean(debug),
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json(
          buildPreviewErrorEnvelope(
            "Invalid preview payload",
            zodIssuesToPreviewDetails((error as any)?.issues),
          ),
        );
      }
      if (error?.code === "PBV2_FORMULA_ERROR" && Array.isArray(error?.details)) {
        return res.json({
          success: false,
          message: "Formula evaluation failed",
          errors: error.details,
          debug: error?.debug,
        });
      }
      const message = typeof error?.message === "string" ? error.message : "Failed to evaluate pricing preview";
      return res.status(400).json({ message });
    }
  });

  // ============================================================================
  // Products Core CRUD + export
  // ============================================================================

  app.get("/api/products/export", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const products = await storage.getAllProducts(organizationId);

      const exportData: Array<Record<string, string>> = [];

      for (const product of products) {
        exportData.push({
          Type: 'PRODUCT',
          'Product Name': product.name,
          'Product Description': product.description || '',
          'Pricing Formula': product.pricingFormula || '',
          'Measurement Mode': product.measurementMode,
          'Variant Label': product.variantLabel || '',
          Category: product.category || '',
          'Store URL': product.storeUrl || '',
          'Show Store Link': product.showStoreLink ? 'true' : 'false',
          'Thumbnail URLs': (product.thumbnailUrls || []).join('|'),
          'Is Active': product.isActive ? 'true' : 'false',
          'Variant Name': '',
          'Variant Description': '',
          'Base Price Per Sqft': '',
          'Is Default Variant': '',
          'Variant Display Order': '',
          'Option Name': '',
          'Option Description': '',
          'Option Type': '',
          'Default Value': '',
          'Default Selection': '',
          'Is Default Enabled': '',
          'Setup Cost': '',
          'Price Formula': '',
          'Parent Option Name': '',
          'Option Display Order': '',
        });

        const variants = await storage.getProductVariants(product.id);
        for (const variant of variants) {
          exportData.push({
            Type: 'VARIANT',
            'Product Name': product.name,
            'Product Description': '',
            'Pricing Formula': '',
            'Variant Label': '',
            Category: '',
            'Store URL': '',
            'Show Store Link': '',
            'Thumbnail URLs': '',
            'Is Active': '',
            'Variant Name': variant.name,
            'Variant Description': variant.description || '',
            'Base Price Per Sqft': variant.basePricePerSqft.toString(),
            'Is Default Variant': variant.isDefault ? 'true' : 'false',
            'Variant Display Order': variant.displayOrder.toString(),
            'Option Name': '',
            'Option Description': '',
            'Option Type': '',
            'Default Value': '',
            'Default Selection': '',
            'Is Default Enabled': '',
            'Setup Cost': '',
            'Price Formula': '',
            'Parent Option Name': '',
            'Option Display Order': '',
          });
        }

        const options = await storage.getProductOptions(product.id);
        const optionIdToNameMap: Record<string, string> = {};
        for (const option of options) {
          optionIdToNameMap[option.id] = option.name;
        }

        for (const option of options) {
          exportData.push({
            Type: 'OPTION',
            'Product Name': product.name,
            'Product Description': '',
            'Pricing Formula': '',
            'Variant Label': '',
            Category: '',
            'Store URL': '',
            'Show Store Link': '',
            'Thumbnail URLs': '',
            'Is Active': '',
            'Variant Name': '',
            'Variant Description': '',
            'Base Price Per Sqft': '',
            'Is Default Variant': '',
            'Variant Display Order': '',
            'Option Name': option.name,
            'Option Description': option.description || '',
            'Option Type': option.type,
            'Default Value': option.defaultValue || '',
            'Default Selection': option.defaultSelection || '',
            'Is Default Enabled': option.isDefaultEnabled ? 'true' : 'false',
            'Setup Cost': option.setupCost.toString(),
            'Price Formula': option.priceFormula || '',
            'Parent Option Name': option.parentOptionId ? (optionIdToNameMap[option.parentOptionId] || '') : '',
            'Option Display Order': option.displayOrder.toString(),
          });
        }
      }

      const csv = Papa.unparse(exportData);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="products-export-${timestamp}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting products:", error);
      res.status(500).json({ message: "Failed to export products" });
    }
  });

  app.post("/api/products/ai-parsing-description/generate", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, message: "Missing organization context" });
      }

      const result = await productParsingDescriptionGeneratorService.generate({
        organizationId,
        actorUserId: getUserId(req.user) ?? null,
        input: req.body,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof ProductParsingDescriptionGeneratorError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          code: "invalid_request",
          message: fromZodError(error).message,
          errors: error.errors,
        });
      }
      console.error("[POST /api/products/ai-parsing-description/generate] Failed:", error);
      return res.status(500).json({
        success: false,
        code: "generation_failed",
        message: "Failed to generate AI parsing description.",
      });
    }
  });

  app.get("/api/products/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const product = await storage.getProductById(organizationId, req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // DEV-ONLY: Log what's being returned
      if (process.env.NODE_ENV !== 'production' && product.optionTreeJson) {
        const nodeCount = typeof product.optionTreeJson === 'object'
          ? Object.keys((product.optionTreeJson as any).nodes || {}).length
          : 0;
        console.log('[GET /api/products/:id] RETURNING optionTreeJson:', {
          type: typeof product.optionTreeJson,
          nodeCount,
          isString: typeof product.optionTreeJson === 'string',
          preview: typeof product.optionTreeJson === 'string' ? (product.optionTreeJson as string).slice(0, 100) : null,
        });
      }

      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.get("/api/products/:id/design-config", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const productId = String(req.params.id);
      const product = await storage.getProductById(organizationId, productId);
      if (!product) {
        return res.status(404).json({ success: false, data: null, message: "Product not found" });
      }

      const config = await productDesignConfigRepository.getByProductId(organizationId, productId);

      return res.json({
        success: true,
        data: config,
        message: config ? "Product design config loaded" : "Product design config not configured",
      });
    } catch (error) {
      console.error("[GET /api/products/:id/design-config] Failed to fetch product design config:", error);
      return res.status(500).json({ success: false, data: null, message: "Failed to fetch product design config" });
    }
  });

  app.put("/api/products/:id/design-config", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const productId = String(req.params.id);
      const product = await storage.getProductById(organizationId, productId);
      if (!product) {
        return res.status(404).json({ success: false, data: null, message: "Product not found" });
      }

      const parsedData = insertProductDesignConfigSchema.parse(req.body);
      const configInput = Object.fromEntries(
        Object.entries(parsedData).map(([key, value]) => [key, typeof value === "string" && value.length === 0 ? null : value]),
      );

      const config = await productDesignConfigRepository.upsertForProduct(
        organizationId,
        productId,
        configInput as any,
      );

      return res.json({ success: true, data: config, message: "Product design config saved" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          data: null,
          message: fromZodError(error).message,
          errors: error.errors,
        });
      }

      console.error("[PUT /api/products/:id/design-config] Failed to save product design config:", error);
      return res.status(500).json({ success: false, data: null, message: "Failed to save product design config" });
    }
  });

  app.post("/api/products", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log("[POST /api/products] Raw request body:", JSON.stringify(req.body, null, 2));

      const parsedData = insertProductSchema.parse(req.body);
      const productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null for optional fields, but preserve strings for required fields like description
        if (k === 'description' || k === 'name') {
          productData[k] = v ?? '';
        } else {
          productData[k] = v === '' ? null : v;
        }
      });

      console.log("[POST /api/products] Parsed & cleaned data:", JSON.stringify(productData, null, 2));

      if (typeof productData.primaryMaterialId === "string" && productData.primaryMaterialId.trim()) {
        const [material] = await db.select({ id: materials.id, organizationId: materials.organizationId, name: materials.name, isActive: materials.isActive }).from(materials).where(and(eq(materials.organizationId, organizationId), eq(materials.id, productData.primaryMaterialId.trim()))).limit(1);
        validateCanonicalProductMaterialSelection(canonicalProductMaterialProposalFromTrustedId(productData.primaryMaterialId.trim()), material ?? null);
      }

      const sanitizedProductData = sanitizeLegacyPriceBreaksForPbv2(
        applyProductWorkflowIntentDefaults(normalizeProductRotationForWrite(productData)),
      );
      const product = await storage.createProduct(organizationId, sanitizedProductData as InsertProduct);
      res.json(product);
    } catch (error) {
      if (error instanceof CanonicalProductMaterialError) {
        const status = error.code === "MATERIAL_NOT_FOUND" ? 404 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        console.error("[POST /api/products] Zod validation error:", error.errors);
        return res.status(400).json({
          message: fromZodError(error).message,
          errors: error.errors
        });
      }
      console.error("[POST /api/products] Error creating product:", error);
      console.error("Stack trace:", (error as Error).stack);
      res.status(500).json({
        message: "Failed to create product",
        error: (error as Error).message
      });
    }
  });

  app.patch("/api/products/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const productId = String(req.params.id);

      const parsedData = updateProductSchema.parse(req.body);
      let existingProduct = await storage.getProductById(organizationId, productId);
      if (!existingProduct) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      let productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null for optional fields, but preserve strings for required fields like description
        if (k === "description" || k === "name") {
          productData[k] = v ?? "";
        } else {
          productData[k] = v === "" ? null : v;
        }
      });

      const requestedPrimaryMaterialId = takeCanonicalProductMaterialChange(productData);
      const requestedActive = takeCanonicalProductLifecycleChange(productData);
      const requestedPricingEngineConfiguration = takeCanonicalProductPricingEngineConfigurationChange(productData, existingProduct.pricingProfileConfig);

      // Product Editor identity, operational configuration, and pricing
      // metadata use the same transport-independent operations available to
      // confirmed Operator paths. Lifecycle and unrelated fields remain here.
      const canonicalChanges = takeCanonicalProductConfigurationChanges(productData);
      if (canonicalChanges) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
        try {
          const result = await canonicalProductConfigurationOperations.execute({
            organizationId, actorUserId,
            productId, changes: canonicalChanges,
            auditContext: { source: "product_editor", reference: `route:PATCH:/api/products/${productId}` },
          });
          existingProduct = result.product;
        } catch (error) {
          // The Product Editor submits its complete form state.  A canonical
          // configuration no-op is therefore an idempotent sub-operation, not
          // a failed Product save.  Keep the stricter error intact for AI
          // proposals, where no-change feedback is intentional.
          if (!(error instanceof CanonicalProductConfigurationError) || error.code !== "NO_PRODUCT_CONFIGURATION_CHANGES") throw error;
        }
      }

      const pricingMetadataChanges = takeCanonicalProductPricingMetadataChanges(productData);
      if (pricingMetadataChanges) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
        const result = await canonicalProductPricingOperations.updateProductMetadata({
          organizationId,
          actorUserId,
          productId,
          changes: pricingMetadataChanges,
        });
        existingProduct = result.product;
      }

      if (requestedPricingEngineConfiguration) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
        const result = await canonicalProductPricingEngineConfigurationOperations.execute({ organizationId, actorUserId, productId, changes: requestedPricingEngineConfiguration, expectedUpdatedAt: new Date(existingProduct.updatedAt).toISOString(), auditContext: { source: "product_editor", reference: `route:PATCH:/api/products/${productId}` } });
        existingProduct = result.product;
      }

      if (requestedPrimaryMaterialId !== undefined) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
        const result = await canonicalProductMaterialOperations.execute({
          organizationId,
          actorUserId,
          productId,
          material: canonicalProductMaterialProposalFromTrustedId(requestedPrimaryMaterialId),
          expectedUpdatedAt: new Date(existingProduct.updatedAt).toISOString(),
          auditContext: { source: "product_editor", reference: `route:PATCH:/api/products/${productId}` },
        });
        existingProduct = result.product;
      }

      if (requestedActive !== undefined) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ success: false, code: "ACTOR_REQUIRED", message: "An authenticated actor is required." });
        const result = await canonicalProductLifecycleOperations.execute({ organizationId, actorUserId, productId, isActive: requestedActive, expectedUpdatedAt: new Date(existingProduct.updatedAt).toISOString(), auditContext: { source: "product_editor", reference: `route:PATCH:/api/products/${productId}` } });
        existingProduct = result.product;
      }

      if (Object.prototype.hasOwnProperty.call(productData, "productTypeId")) {
        const knownProductTypeRows = await db
          .select({ id: productTypes.id })
          .from(productTypes)
          .where(eq(productTypes.organizationId, organizationId));

        const productTypeGuard = applyProductTypeIdUpdateGuard({
          productData,
          existingProductTypeId: existingProduct.productTypeId,
          knownProductTypeIds: knownProductTypeRows.map((row) => row.id),
        });

        if (!productTypeGuard.ok) {
          return res.status(productTypeGuard.status).json({
            success: false,
            message: productTypeGuard.message,
            code: productTypeGuard.code,
            details: productTypeGuard.details,
          });
        }

        productData = productTypeGuard.productData;
        if (productTypeGuard.warning) {
          console.warn("[PATCH /api/products/:id] Preserved productTypeId during blank update", {
            productId,
            organizationId,
            code: productTypeGuard.warning.code,
            attemptedValue: productTypeGuard.warning.attemptedValue,
            preservedValue: productTypeGuard.warning.preservedValue,
          });
        }
      }

      // Guard: do not attempt an update with no fields.
      if (Object.keys(productData).length === 0) {
        return res.json(existingProduct);
      }

      // DEV-ONLY: Log productData before storage.updateProduct
      if (process.env.NODE_ENV !== "production") {
        console.log("[PATCH /api/products/:id] productData keys:", Object.keys(productData));
        console.log("[PATCH /api/products/:id] optionTreeJson:", {
          hasField: 'optionTreeJson' in productData,
          type: typeof productData.optionTreeJson,
          length: productData.optionTreeJson ? JSON.stringify(productData.optionTreeJson).length : 0,
        });
      }

      // Validate optionsJson is JSON-safe + enforce a reasonable size limit.
      if (Object.prototype.hasOwnProperty.call(productData, "optionsJson")) {
        const optionsJson = productData.optionsJson;
        if (optionsJson != null) {
          let jsonText: string;
          try {
            jsonText = JSON.stringify(optionsJson);
          } catch {
            return res.status(400).json({ success: false, message: "optionsJson must be valid JSON" });
          }

          // Size guard (prevents accidentally storing transient UI state).
          if (jsonText.length > 250_000) {
            return res.status(400).json({ success: false, message: "optionsJson is too large" });
          }

          // Round-trip to ensure it can be serialized safely.
          try {
            productData.optionsJson = JSON.parse(jsonText);
          } catch {
            return res.status(400).json({ success: false, message: "optionsJson must be valid JSON" });
          }
        }
      }

      // Validate optionTreeJson is JSON-safe (Option Tree v2 payload).
      if (Object.prototype.hasOwnProperty.call(productData, "optionTreeJson")) {
        const optionTreeJson = productData.optionTreeJson;
        if (optionTreeJson != null) {
          let jsonText: string;
          try {
            jsonText = JSON.stringify(optionTreeJson);
          } catch {
            return res.status(400).json({ success: false, message: "optionTreeJson must be valid JSON" });
          }

          // Round-trip to ensure it can be serialized safely.
          try {
            productData.optionTreeJson = JSON.parse(jsonText);
          } catch {
            return res.status(400).json({ success: false, message: "optionTreeJson must be valid JSON" });
          }
        }
      }

      const sanitizedProductData = sanitizeLegacyPriceBreaksForPbv2(
        applyProductWorkflowIntentDefaults(
          normalizeProductRotationForWrite(productData, existingProduct),
          existingProduct.workflowIntent,
        ),
        existingProduct,
      );
      const product = await storage.updateProduct(organizationId, productId, sanitizedProductData as UpdateProduct);
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      // DEV-ONLY: Verify what was actually written to DB
      if (process.env.NODE_ENV !== 'production' && 'optionTreeJson' in productData) {
        const dbNodeCount = product.optionTreeJson && typeof product.optionTreeJson === 'object'
          ? Object.keys((product.optionTreeJson as any).nodes || {}).length
          : 0;
        console.log('[PATCH /api/products/:id] DB WRITE VERIFIED:', {
          returnedType: typeof product.optionTreeJson,
          dbNodeCount,
          schemaVersion: (product.optionTreeJson as any)?.schemaVersion,
        });
      }

      res.json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message, errors: error.errors });
      }
      if (error instanceof CanonicalProductConfigurationError) {
        const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "PRODUCT_CONFIGURATION_STALE" ? 409 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message });
      }
      if (error instanceof CanonicalProductPricingError) {
        const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "PRODUCT_PRICING_STALE" ? 409 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message, findings: error.findings });
      }
      if (error instanceof CanonicalProductPricingEngineConfigurationError) {
        const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "PRODUCT_PRICING_ENGINE_STALE" ? 409 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message });
      }
      if (error instanceof CanonicalProductMaterialError) {
        const status = error.code === "PRODUCT_NOT_FOUND" || error.code === "MATERIAL_NOT_FOUND" ? 404 : error.code === "PRODUCT_MATERIAL_STALE" ? 409 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message });
      }
      if (error instanceof CanonicalProductLifecycleError) {
        const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "PRODUCT_LIFECYCLE_STALE" || error.code === "PBV2_DRAFT_MUST_BE_PUBLISHED" ? 409 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message });
      }

      const errorId = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyCrypto: any = globalThis.crypto;
          if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
        } catch {
          // ignore
        }
        return `err_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      })();

      const productId = String(req.params.id);
      const bodyKeys = req?.body && typeof req.body === "object" ? Object.keys(req.body) : [];

      let optionsPreview: { length: number; preview: string } | null = null;
      try {
        if (req?.body && typeof req.body === "object" && "optionsJson" in req.body) {
          const text = JSON.stringify((req.body as any).optionsJson);
          optionsPreview = { length: text?.length ?? 0, preview: String(text || "").slice(0, 500) };
        }
      } catch {
        optionsPreview = { length: -1, preview: "<unstringifiable>" };
      }

      const anyErr: any = error as any;
      console.error("[PATCH /api/products/:id] Failed to update product", {
        errorId,
        productId,
        organizationId: getRequestOrganizationId(req) ?? undefined,
        bodyKeys,
        optionsPreview,
        errorMessage: anyErr?.message,
        errorCode: anyErr?.code,
        errorDetail: anyErr?.detail,
        errorConstraint: anyErr?.constraint,
      });

      res.status(500).json({ success: false, message: "Failed to update product", errorId });
    }
  });

  app.put("/api/products/:id/thumbnails", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { thumbnailUrls } = req.body;
      if (!Array.isArray(thumbnailUrls)) {
        return res.status(400).json({ message: "thumbnailUrls must be an array" });
      }

      const userId = getUserId(req.user);
      const objectStorageService = new ObjectStorageService();
      const normalizedPaths: string[] = [];

      for (const rawPath of thumbnailUrls) {
        if (typeof rawPath !== 'string' || !rawPath) continue;

        const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
          rawPath,
          {
            owner: userId || 'system',
            visibility: "public",
          }
        );
        normalizedPaths.push(normalizedPath);
      }

      const product = await storage.updateProduct(organizationId, req.params.id, {
        thumbnailUrls: normalizedPaths
      } as UpdateProduct);

      res.json(product);
    } catch (error) {
      console.error("Error updating product thumbnails:", error);
      res.status(500).json({ message: "Failed to update product thumbnails" });
    }
  });

  app.delete("/api/products/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteProduct(organizationId, req.params.id);
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  app.post("/api/products/:id/clone", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const clonedProduct = await storage.duplicateProduct(organizationId, req.params.id, userId ?? null);
      res.json(clonedProduct);
    } catch (error) {
      console.error("Error cloning product:", error);
      const message = error instanceof Error ? error.message : "Failed to clone product";
      if (message.startsWith("Cannot duplicate product") || message.includes("PBV2 active tree version not found")) {
        return res.status(409).json({ message });
      }
      res.status(500).json({ message: "Failed to clone product" });
    }
  });

  app.post("/api/products/:productId/duplicate", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userId = getUserId(req.user);
      const duplicated = await storage.duplicateProduct(organizationId, req.params.productId, userId ?? null);
      return res.json(duplicated);
    } catch (error) {
      console.error("Error duplicating product:", error);
      const message = error instanceof Error ? error.message : "Failed to duplicate product";
      if (message.startsWith("Cannot duplicate product") || message.includes("PBV2 active tree version not found")) {
        return res.status(409).json({ message });
      }
      return res.status(500).json({ message: "Failed to duplicate product" });
    }
  });

  // ============================================================================
  // Product Options
  // ============================================================================

  app.get("/api/products/:id/options", isAuthenticated, tenantContext, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const options = await storage.getProductOptions(req.params.id);
      res.json(options);
    } catch (error) {
      console.error("Error fetching product options:", error);
      res.status(500).json({ message: "Failed to fetch product options" });
    }
  });

  app.post("/api/products/:id/options", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const optionData = insertProductOptionSchema.parse({
        ...req.body,
        productId: req.params.id,
      });
      const option = await storage.createProductOption(optionData);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating product option:", error);
      res.status(500).json({ message: "Failed to create product option" });
    }
  });

  app.patch("/api/products/:productId/options/:id", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.productId);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const [existingOption] = await db.select({ id: productOptions.id }).from(productOptions).where(and(eq(productOptions.id, req.params.id), eq(productOptions.productId, req.params.productId))).limit(1);
      if (!existingOption) return res.status(404).json({ message: "Product option not found" });
      const optionData = updateProductOptionSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const option = await storage.updateProductOption(req.params.id, optionData);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating product option:", error);
      res.status(500).json({ message: "Failed to update product option" });
    }
  });

  app.delete("/api/products/:productId/options/:id", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.productId);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const [existingOption] = await db.select({ id: productOptions.id }).from(productOptions).where(and(eq(productOptions.id, req.params.id), eq(productOptions.productId, req.params.productId))).limit(1);
      if (!existingOption) return res.status(404).json({ message: "Product option not found" });
      await storage.deleteProductOption(req.params.id);
      res.json({ message: "Product option deleted successfully" });
    } catch (error) {
      console.error("Error deleting product option:", error);
      res.status(500).json({ message: "Failed to delete product option" });
    }
  });

  // ============================================================================
  // Product Variants
  // ============================================================================

  app.get("/api/products/:id/variants", isAuthenticated, tenantContext, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const variants = await storage.getProductVariants(req.params.id);
      res.json(variants);
    } catch (error) {
      console.error("Error fetching product variants:", error);
      res.status(500).json({ message: "Failed to fetch product variants" });
    }
  });

  app.post("/api/products/:id/variants", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const variantData = insertProductVariantSchema.parse({
        ...req.body,
        productId: req.params.id,
      });
      const variant = await storage.createProductVariant(variantData);
      res.json(variant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating product variant:", error);
      res.status(500).json({ message: "Failed to create product variant" });
    }
  });

  app.patch("/api/products/:productId/variants/:id", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.productId);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const [existingVariant] = await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.id, req.params.id), eq(productVariants.productId, req.params.productId))).limit(1);
      if (!existingVariant) return res.status(404).json({ message: "Product variant not found" });
      const variantData = updateProductVariantSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const variant = await storage.updateProductVariant(req.params.id, variantData);
      res.json(variant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating product variant:", error);
      res.status(500).json({ message: "Failed to update product variant" });
    }
  });

  app.delete("/api/products/:productId/variants/:id", isAuthenticated, tenantContext, isAdmin, async (req, res) => {
    try {
      const product = await storage.getProductById(getRequestOrganizationId(req), req.params.productId);
      if (!product) return res.status(404).json({ message: "Product not found" });
      const [existingVariant] = await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.id, req.params.id), eq(productVariants.productId, req.params.productId))).limit(1);
      if (!existingVariant) return res.status(404).json({ message: "Product variant not found" });
      await storage.deleteProductVariant(req.params.id);
      res.json({ message: "Product variant deleted successfully" });
    } catch (error) {
      console.error("Error deleting product variant:", error);
      res.status(500).json({ message: "Failed to delete product variant" });
    }
  });

}
