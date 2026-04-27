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
  pbv2TreeVersions,
  productTypes,
  materials,
  organizations,
  auditLogs,
  insertProductDesignConfigSchema,
} from "@shared/schema";
import { eq, desc, and, asc, inArray, sql } from "drizzle-orm";
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
import { readPbv2OverrideConfig, writePbv2OverrideConfig } from "../lib/pbv2OverrideConfig";
import { productDesignConfigRepository } from "../storage/productDesignConfig.repo";

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
      res.json(
        activeOnly === "true" || activeOnly === "1"
          ? products.filter((product) => product.isActive)
          : products,
      );
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/csv-template", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const templateData = [
        { Type: 'PRODUCT', 'Product Name': 'Business Cards', 'Product Description': 'High-quality business cards', 'Pricing Formula': 'basePrice * quantity', 'Variant Label': 'Media Type', Category: 'Cards', 'Store URL': 'https://example.com/business-cards', 'Show Store Link': 'true', 'Thumbnail URLs': '', 'Is Active': 'true', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
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
          const thumbnailUrlsRaw = row['Thumbnail URLs']?.trim() || '';
          const thumbnailUrls = thumbnailUrlsRaw
            ? thumbnailUrlsRaw.split('|').map(url => url.trim()).filter(url => url.length > 0)
            : [];

          type InsertProductWithoutOrgId = Omit<InsertProduct, "organizationId">;
          const insertPayload: InsertProductWithoutOrgId = {
            name: productName,
            description: row['Product Description']?.trim() || '',
            pricingProfileKey: "default",
            pricingMode: "area",
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

      // Fetch all products for org
      const allProducts = await db
        .select()
        .from(products)
        .where(eq(products.organizationId, organizationId))
        .orderBy(asc(products.name));

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
      const [allProductTypes, allMaterials, org] = await Promise.all([
        db.select().from(productTypes).where(eq(productTypes.organizationId, organizationId)),
        db.select().from(materials).where(eq(materials.organizationId, organizationId)),
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
        allMaterials
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
      res.status(500).json({ error: error.message || "Failed to export products" });
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

      // Verify product exists
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      // Read DRAFT from pbv2_tree_versions table
      const [draft] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

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

  app.put("/api/products/:productId/pbv2/draft", isAuthenticated, tenantContext, async (req: any, res) => {
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

      // Upsert: update if exists, insert if not
      // CRITICAL: Order by updated_at DESC to get most recent draft deterministically
      // This prevents repeated INSERTs when activation is blocked (draft stays DRAFT)
      const [existingDraft] = await db
        .select({ id: pbv2TreeVersions.id, updatedAt: pbv2TreeVersions.updatedAt })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      console.log('[PBV2_DRAFT_PUT] existing draft check', {
        existingDraftId: existingDraft?.id || null,
        action: existingDraft ? 'UPDATE' : 'INSERT'
      });

      let draft;
      try {
        const schemaVersion = (treeJson as any).schemaVersion ?? 2;
        if (existingDraft) {
          [draft] = await db
            .update(pbv2TreeVersions)
            .set({
              treeJson: treeJson,
              schemaVersion: schemaVersion,
              updatedByUserId: userId ?? null,
              updatedAt: new Date(),
            })
            .where(eq(pbv2TreeVersions.id, existingDraft.id))
            .returning();
          console.log('[PBV2_DRAFT_PUT] UPDATE succeeded', { draftId: draft.id });
        } else {
          [draft] = await db
            .insert(pbv2TreeVersions)
            .values({
              organizationId,
              productId,
              status: "DRAFT",
              schemaVersion: schemaVersion,
              treeJson: treeJson,
              createdByUserId: userId ?? null,
              updatedByUserId: userId ?? null,
            })
            .returning();
          console.log('[PBV2_DRAFT_PUT] INSERT succeeded', { draftId: draft.id });
        }
      } catch (dbError: any) {
        console.error('[PBV2_DRAFT_PUT] DB write failed:', dbError);
        console.error('[PBV2_DRAFT_PUT] DB error stack:', dbError.stack);
        throw dbError;
      }

      // LOG 3: Verify row exists with SELECT COUNT
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        );

      console.log('[PBV2_DRAFT_PUT] after write count', {
        count: countResult.count,
        draftId: draft.id,
        productId,
        orgId: organizationId
      });

      // HARD FAIL: If no row exists after write, return 500
      if (countResult.count < 1) {
        console.error('[PBV2_DRAFT_PUT] HARD FAIL: no row after write', {
          orgId: organizationId,
          productId,
          attemptedDraftId: draft?.id || 'null'
        });
        return res.status(500).json({
          success: false,
          message: "PBV2 draft write failed: no row after write"
        });
      }

      // Additional verification: SELECT the actual row
      const [verifiedDraft] = await db
        .select({ id: pbv2TreeVersions.id })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      if (!verifiedDraft) {
        console.error('[PBV2_DRAFT_PUT] HARD FAIL: verification SELECT returned no row', {
          orgId: organizationId,
          productId,
          attemptedDraftId: draft?.id || 'null'
        });
        return res.status(500).json({
          success: false,
          message: "PBV2 draft write failed: verification SELECT returned no row"
        });
      }

      console.log('[PBV2_DRAFT_PUT] verification SELECT succeeded', { verifiedId: verifiedDraft.id });

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

      if (org?.pbv2ActivationMode === 'auto_on_save') {
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
            const publishValidation = validateTreeForPublish((draft as any).treeJson as any, DEFAULT_VALIDATE_OPTS);

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

                // Update product pointer
                await tx
                  .update(products)
                  .set({ pbv2ActiveTreeVersionId: draft.id, updatedAt: publishedAt })
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
      console.error('[PBV2_DRAFT_PUT] FATAL ERROR:', error);
      console.error('[PBV2_DRAFT_PUT] error stack:', error.stack);
      return res.status(500).json({ success: false, message: "Failed to upsert PBV2 draft", error: error.message });
    }
  });


  app.post("/api/pbv2/tree-versions/:id/publish", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = req.params;
      const confirmWarnings = String((req.query as any)?.confirmWarnings ?? "").toLowerCase() === "true";
      const userId = getUserId(req.user);

      const [draft] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, id)))
        .limit(1);

      if (!draft) return res.status(404).json({ success: false, message: "Tree version not found" });

      // Idempotency: If already ACTIVE, check if product points to it
      if (draft.status === "ACTIVE") {
        const [product] = await db
          .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
          .from(products)
          .where(and(eq(products.id, draft.productId), eq(products.organizationId, organizationId)))
          .limit(1);

        if (product && product.pbv2ActiveTreeVersionId === id) {
          // Already published and active - idempotent success
          console.log(`[PBV2_PUBLISH_IDEMPOTENT] orgId=${organizationId} productId=${draft.productId} treeVersionId=${id} status=already_active`);
          return res.json({
            success: true,
            data: draft,
            productId: draft.productId,
            pbv2ActiveTreeVersionId: id,
            message: "Tree version already published and active"
          });
        }
      }

      if (draft.status !== "DRAFT") {
        return res.status(409).json({ success: false, message: "Only DRAFT tree versions can be published" });
      }

      // GUARDRAIL 1: Validate schemaVersion = 2
      const treeJson = (draft as any).treeJson as any;
      const schemaVersion = treeJson?.schemaVersion ?? 1;
      if (schemaVersion !== 2) {
        console.warn(`[PBV2_ACTIVATION_BLOCKED] orgId=${organizationId} productId=${draft.productId} treeVersionId=${id} reason=schema_version_unsupported schemaVersion=${schemaVersion}`);
        return res.status(400).json({
          success: false,
          code: "PBV2_E_SCHEMA_VERSION_UNSUPPORTED",
          message: "Cannot activate this PBV2 tree: schema version outdated",
          error: "This tree uses PBV2 schema v" + schemaVersion + ". Only v2 trees can be activated. Open the product in the PBV2 builder and re-save to upgrade, then try publishing again.",
          findings: [{
            severity: "error",
            message: "Tree must be PBV2 schema version 2",
            path: "schemaVersion",
            actual: schemaVersion,
            expected: 2,
          }],
        });
      }

      // GUARDRAIL 2: Validate base pricing is configured
      const { validateTreeHasBasePrice } = await import("../../shared/pbv2/validator/validateBasePrice");
      const basePriceValidation = validateTreeHasBasePrice(treeJson);
      if (basePriceValidation.errors.length > 0) {
        console.warn(`[PBV2_ACTIVATION_BLOCKED] orgId=${organizationId} productId=${draft.productId} treeVersionId=${id} reason=missing_base_price`);
        return res.status(400).json({
          success: false,
          message: "PBV2 tree requires base pricing configuration before activation",
          error: "Base pricing must be configured in the Base Pricing section. Set at least one of: $/sqft, $/piece, or minimum charge.",
          findings: basePriceValidation.findings,
        });
      }

      // Validate publish gate (Appendix 5)
      const validation = validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS);
      if (validation.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "PBV2 publish blocked by validation errors",
          findings: validation.findings,
        });
      }

      if (validation.warnings.length > 0 && !confirmWarnings) {
        return res.json({
          success: true,
          requiresWarningsConfirm: true,
          findings: validation.findings,
        });
      }

      const publishedAt = new Date();

      const result = await db.transaction(async (tx) => {
        const [product] = await tx
          .select({ id: products.id, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
          .from(products)
          .where(and(eq(products.id, draft.productId), eq(products.organizationId, organizationId)))
          .limit(1);

        if (!product) {
          throw Object.assign(new Error("Product not found"), { statusCode: 404 });
        }

        const previousActiveId = product.pbv2ActiveTreeVersionId;
        if (previousActiveId && previousActiveId !== draft.id) {
          await tx
            .update(pbv2TreeVersions)
            .set({ status: "DEPRECATED", updatedAt: publishedAt, updatedByUserId: userId ?? null })
            .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, previousActiveId)));
        }

        const nextTreeJson: Record<string, any> = {
          ...(draft as any).treeJson,
          schemaVersion: 2, // Preserve v2 schema
          status: "ACTIVE",
        };

        const [updatedVersion] = await tx
          .update(pbv2TreeVersions)
          .set({
            status: "ACTIVE",
            publishedAt,
            updatedAt: publishedAt,
            updatedByUserId: userId ?? null,
            treeJson: nextTreeJson,
          })
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, draft.id)))
          .returning();

        await tx
          .update(products)
          .set({ pbv2ActiveTreeVersionId: draft.id, updatedAt: publishedAt })
          .where(and(eq(products.id, draft.productId), eq(products.organizationId, organizationId)));

        console.log(`[PBV2_PUBLISH_SUCCESS] orgId=${organizationId} productId=${draft.productId} treeVersionId=${draft.id} previousActiveId=${previousActiveId || 'none'}`);

        return {
          updatedVersion,
          productId: draft.productId,
          pbv2ActiveTreeVersionId: draft.id
        };
      });

      return res.json({
        success: true,
        data: result.updatedVersion,
        productId: result.productId,
        pbv2ActiveTreeVersionId: result.pbv2ActiveTreeVersionId,
        findings: validation.findings
      });
    } catch (error: any) {
      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
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
        treeJson,
        width,
        height,
        quantity,
        optionSelectionsJson,
        pricingFormulaOverride,
        pricingProfileKey,
        pricingProfileConfig,
        debug,
      } = req.body ?? {};

      if (!treeJson || typeof treeJson !== "object") {
        return res.status(400).json({ message: "treeJson is required" });
      }

      const widthNum = Number(width);
      const heightNum = Number(height);
      const quantityNum = Number(quantity);

      if (!Number.isFinite(widthNum) || widthNum <= 0) {
        return res.status(400).json({ message: "width must be a positive number" });
      }
      if (!Number.isFinite(heightNum) || heightNum <= 0) {
        return res.status(400).json({ message: "height must be a positive number" });
      }
      if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
        return res.status(400).json({ message: "quantity must be a positive number" });
      }

      let pbv2ExplicitSelections: Record<string, any> = {};
      if (optionSelectionsJson != null) {
        pbv2ExplicitSelections = typeof optionSelectionsJson === "string"
          ? JSON.parse(optionSelectionsJson)
          : optionSelectionsJson;
      }

      const { evaluatePricingPreviewFromTree } = await import("../services/pricing/PricingService");
      const result = evaluatePricingPreviewFromTree({
        treeJson,
        widthIn: widthNum,
        heightIn: heightNum,
        quantity: quantityNum,
        pbv2ExplicitSelections,
        pricingFormulaOverride: typeof pricingFormulaOverride === "string" ? pricingFormulaOverride : undefined,
        pricingProfileKey: typeof pricingProfileKey === "string" ? pricingProfileKey : undefined,
        pricingProfileConfig: pricingProfileConfig ?? undefined,
        debug: Boolean(debug),
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid preview payload" });
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

      const product = await storage.createProduct(organizationId, productData as InsertProduct);
      res.json(product);
    } catch (error) {
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

      const productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null for optional fields, but preserve strings for required fields like description
        if (k === "description" || k === "name") {
          productData[k] = v ?? "";
        } else {
          productData[k] = v === "" ? null : v;
        }
      });

      // Guard: do not attempt an update with no fields.
      if (Object.keys(productData).length === 0) {
        return res.status(400).json({ success: false, message: "No fields to update" });
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

      const product = await storage.updateProduct(organizationId, productId, productData as UpdateProduct);
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

      // ============================================================
      // PBV2 BASE PRICING PROPAGATION
      // ============================================================
      // After product save, propagate DRAFT base pricing to ACTIVE tree
      // This ensures /calculate uses current pricing without manual publish
      const userId = getUserId(req.user);

      if (product.pbv2ActiveTreeVersionId) {
        try {
          // Load DRAFT tree version
          const [draftTreeVersion] = await db
            .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
            .from(pbv2TreeVersions)
            .where(
              and(
                eq(pbv2TreeVersions.organizationId, organizationId),
                eq(pbv2TreeVersions.productId, productId),
                eq(pbv2TreeVersions.status, "DRAFT")
              )
            )
            .limit(1);

          if (draftTreeVersion) {
            // Load current ACTIVE tree version
            const [activeTreeVersion] = await db
              .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
              .from(pbv2TreeVersions)
              .where(
                and(
                  eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId),
                  eq(pbv2TreeVersions.organizationId, organizationId),
                  eq(pbv2TreeVersions.status, "ACTIVE")
                )
              )
              .limit(1);

            if (activeTreeVersion) {
              // Extract base pricing from DRAFT and ACTIVE
              const draftTree = draftTreeVersion.treeJson as any;
              const activeTree = activeTreeVersion.treeJson as any;
              const draftBasePricing = draftTree?.meta?.pricingV2?.base;
              const activeBasePricing = activeTree?.meta?.pricingV2?.base;

              // Compare base pricing - only propagate if changed
              const basePricingChanged = JSON.stringify(draftBasePricing) !== JSON.stringify(activeBasePricing);

              if (basePricingChanged && draftBasePricing) {
                console.log('[PBV2_BASE_PRICING_PROPAGATION] detected change', {
                  productId,
                  activeTreeVersionId: activeTreeVersion.id,
                  draftBasePricing,
                  activeBasePricing,
                });

                // Deep clone ACTIVE tree and update only meta.pricingV2.base
                const updatedActiveTree = JSON.parse(JSON.stringify(activeTree));
                if (!updatedActiveTree.meta) updatedActiveTree.meta = {};
                if (!updatedActiveTree.meta.pricingV2) updatedActiveTree.meta.pricingV2 = {};
                updatedActiveTree.meta.pricingV2.base = draftBasePricing;

                // Use transaction to ensure atomic state transition: DEPRECATE old → INSERT new → UPDATE pointer
                const newActiveVersion = await db.transaction(async (tx) => {
                  // STEP 1: Deprecate old ACTIVE version FIRST (removes unique constraint conflict)
                  await tx
                    .update(pbv2TreeVersions)
                    .set({
                      status: "DEPRECATED",
                      updatedAt: new Date(),
                      updatedByUserId: userId ?? null
                    })
                    .where(
                      and(
                        eq(pbv2TreeVersions.id, activeTreeVersion.id),
                        eq(pbv2TreeVersions.organizationId, organizationId)
                      )
                    );

                  // STEP 2: Create NEW ACTIVE tree version (immutability preserved)
                  const [newVersion] = await tx
                    .insert(pbv2TreeVersions)
                    .values({
                      organizationId,
                      productId,
                      status: "ACTIVE",
                      schemaVersion: updatedActiveTree.schemaVersion ?? 2,
                      treeJson: updatedActiveTree,
                      publishedAt: new Date(),
                      createdByUserId: userId ?? null,
                      updatedByUserId: userId ?? null,
                    })
                    .returning();

                  // STEP 3: Update product pointer to new ACTIVE version
                  await tx
                    .update(products)
                    .set({
                      pbv2ActiveTreeVersionId: newVersion.id,
                      updatedAt: new Date()
                    })
                    .where(
                      and(
                        eq(products.id, productId),
                        eq(products.organizationId, organizationId)
                      )
                    );

                  return newVersion;
                });

                console.log('[PBV2_BASE_PRICING_PROPAGATION] success - status transitions completed', {
                  productId,
                  oldActiveId: activeTreeVersion.id,
                  oldStatus: 'ACTIVE → DEPRECATED',
                  newActiveId: newActiveVersion.id,
                  newStatus: 'ACTIVE',
                  basePricing: draftBasePricing,
                });

                // Update product object for response
                product.pbv2ActiveTreeVersionId = newActiveVersion.id;
              } else {
                console.log('[PBV2_BASE_PRICING_PROPAGATION] skipped - no change', {
                  productId,
                  activeTreeVersionId: activeTreeVersion.id,
                });
              }
            }
          }
        } catch (propagationError: any) {
          // Don't fail product save if propagation fails
          console.error('[PBV2_BASE_PRICING_PROPAGATION] failed', {
            productId,
            error: propagationError.message,
            stack: propagationError.stack,
          });
        }
      }

      res.json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message, errors: error.errors });
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
      const clonedProduct = await storage.cloneProduct(organizationId, req.params.id);
      res.json(clonedProduct);
    } catch (error) {
      console.error("Error cloning product:", error);
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
      return res.status(500).json({ message: "Failed to duplicate product" });
    }
  });

  // ============================================================================
  // Product Options
  // ============================================================================

  app.get("/api/products/:id/options", isAuthenticated, async (req, res) => {
    try {
      const options = await storage.getProductOptions(req.params.id);
      res.json(options);
    } catch (error) {
      console.error("Error fetching product options:", error);
      res.status(500).json({ message: "Failed to fetch product options" });
    }
  });

  app.post("/api/products/:id/options", isAuthenticated, isAdmin, async (req, res) => {
    try {
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

  app.patch("/api/products/:productId/options/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
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

  app.delete("/api/products/:productId/options/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
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

  app.get("/api/products/:id/variants", isAuthenticated, async (req, res) => {
    try {
      const variants = await storage.getProductVariants(req.params.id);
      res.json(variants);
    } catch (error) {
      console.error("Error fetching product variants:", error);
      res.status(500).json({ message: "Failed to fetch product variants" });
    }
  });

  app.post("/api/products/:id/variants", isAuthenticated, isAdmin, async (req, res) => {
    try {
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

  app.patch("/api/products/:productId/variants/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
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

  app.delete("/api/products/:productId/variants/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteProductVariant(req.params.id);
      res.json({ message: "Product variant deleted successfully" });
    } catch (error) {
      console.error("Error deleting product variant:", error);
      res.status(500).json({ message: "Failed to delete product variant" });
    }
  });

}
