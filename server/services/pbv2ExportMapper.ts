/**
 * PBV2 Product Export Mapper
 * 
 * Serializes database product records (including PBV2 tree versions) into 
 * portable JSON format suitable for cross-org import/export.
 * 
 * Key principles:
 * - Use stable keys (SKU, slug, name) instead of raw database IDs
 * - Export complete PBV2 tree structures (ACTIVE + DRAFT)
 * - Preserve all pricing configuration and calculator settings
 * - Include reference mappings for resolution on import
 */

import type { ProductExportV2, ProductExportV2Item } from "@shared/importExportSchemas";
import type { db as DbType } from "../db";
import { isPbv2ProductPayloadLike } from "@shared/pbv2/legacyPriceBreaks";

type Product = any; // From Drizzle select
type Pbv2TreeVersion = any;
type ProductType = any;
type Material = any;

export interface ExportMapperContext {
  db: typeof DbType;
  organizationId: string;
  orgName?: string;
}

/**
 * Export all products for an organization with full PBV2 trees
 */
export async function exportProducts(
  ctx: ExportMapperContext,
  products: Product[],
  pbv2Trees: Map<string, { active?: Pbv2TreeVersion; draft?: Pbv2TreeVersion }>,
  productTypes: ProductType[],
  materials: Material[]
): Promise<ProductExportV2> {
  
  // Build lookup maps for reference resolution
  const productTypeById = new Map(productTypes.map(pt => [pt.id, pt]));
  const materialById = new Map(materials.map(m => [m.id, m]));
  
  const exportedProducts: ProductExportV2Item[] = [];
  
  for (const product of products) {
    const pbv2Data = pbv2Trees.get(product.id);
    const isPbv2Product = isPbv2ProductPayloadLike({ ...product, pbv2: pbv2Data });
    
    // Resolve product type reference
    const productTypeName = product.productTypeId 
      ? productTypeById.get(product.productTypeId)?.name 
      : undefined;
    
    // Resolve primary material reference
    const primaryMaterialSku = product.primaryMaterialId
      ? materialById.get(product.primaryMaterialId)?.sku
      : undefined;
    
    // Generate slug from name if not explicitly stored
    const slug = generateSlugFromName(product.name);
    
    const exportItem: ProductExportV2Item = {
      name: product.name,
      slug,
      description: product.description || "",
      category: product.category || undefined,
      productTypeName,
      
      // Pricing configuration
      pricingMode: product.pricingMode || "area",
      pricingFormula: product.pricingFormula || undefined,
      pricingEngine: product.pricingEngine || "pricingProfile",
      pricingProfileKey: product.pricingProfileKey || undefined,
      pricingProfileConfig: product.pricingProfileConfig || undefined,
      
      primaryMaterialSku,
      
      // Nesting calculator
      useNestingCalculator: product.useNestingCalculator || false,
      sheetWidth: product.sheetWidth ? Number(product.sheetWidth) : undefined,
      sheetHeight: product.sheetHeight ? Number(product.sheetHeight) : undefined,
      materialType: product.materialType || undefined,
      minPricePerItem: product.minPricePerItem ? Number(product.minPricePerItem) : undefined,
      nestingVolumePricing: product.nestingVolumePricing || undefined,
      
      // Legacy price breaks are non-PBV2 only; PBV2 tiers live in meta.pricingV2.
      priceBreaks: isPbv2Product ? undefined : product.priceBreaks || undefined,
      
      // Flags
      isService: product.isService || false,
      requiresProductionJob: product.requiresProductionJob ?? true,
      isTaxable: product.isTaxable ?? true,
      isActive: product.isActive ?? true,
      artworkPolicy: product.artworkPolicy || "not_required",
      
      // Display
      variantLabel: product.variantLabel || "Variant",
      storeUrl: product.storeUrl || undefined,
      showStoreLink: product.showStoreLink ?? true,
      thumbnailUrls: product.thumbnailUrls || [],
      
      // Legacy options
      optionsJson: product.optionsJson || undefined,
      optionTreeJson: product.optionTreeJson || undefined,
      
      // PBV2 tree export
      pbv2: pbv2Data ? {
        hasActiveTree: !!pbv2Data.active,
        activeTree: pbv2Data.active ? {
          schemaVersion: pbv2Data.active.schemaVersion || 1,
          treeJson: pbv2Data.active.treeJson || {},
          publishedAt: pbv2Data.active.publishedAt?.toISOString() || null,
        } : undefined,
        hasDraft: !!pbv2Data.draft,
        draftTree: pbv2Data.draft ? {
          schemaVersion: pbv2Data.draft.schemaVersion || 1,
          treeJson: pbv2Data.draft.treeJson || {},
        } : undefined,
      } : undefined,
    };
    
    exportedProducts.push(exportItem);
  }
  
  // Build mapping tables
  const mappings = {
    productTypes: productTypes.map(pt => ({
      name: pt.name,
      id: pt.id,
    })),
    materials: materials.map(m => ({
      sku: m.sku,
      name: m.name,
      id: m.id,
    })),
  };
  
  return {
    schemaVersion: "products-export/v2",
    exportedAt: new Date().toISOString(),
    orgId: ctx.organizationId,
    orgName: ctx.orgName,
    products: exportedProducts,
    mappings,
  };
}

/**
 * Generate a stable slug from product name
 */
function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim hyphens
}
