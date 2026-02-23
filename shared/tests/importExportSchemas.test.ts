import { describe, test, expect } from '@jest/globals';
import { 
  productsExportV2Schema, 
  productExportV2ItemSchema,
  productImportV2RequestSchema,
  importPlanSchema,
  importResultSchema,
} from '../importExportSchemas';

describe('Product Import/Export Schemas (v2)', () => {
  
  describe('productExportV2ItemSchema', () => {
    test('validates minimal product export item', () => {
      const minimalProduct = {
        name: 'Test Product',
        description: 'Test description',
      };
      
      const result = productExportV2ItemSchema.safeParse(minimalProduct);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Product');
        expect(result.data.pricingMode).toBe('area'); // default
        expect(result.data.isService).toBe(false); // default
      }
    });
    
    test('validates complete product with PBV2 tree', () => {
      const completeProduct = {
        name: 'Banner',
        slug: 'banner',
        description: 'Vinyl banner',
        category: 'Signage',
        productTypeName: 'Flatbed Printing',
        pricingMode: 'area' as const,
        pricingEngine: 'pricingProfile' as const,
        pricingProfileKey: 'flatGoods',
        primaryMaterialSku: 'VIN-13OZ',
        useNestingCalculator: false,
        isService: false,
        requiresProductionJob: true,
        isTaxable: true,
        isActive: true,
        artworkPolicy: 'required' as const,
        thumbnailUrls: ['https://example.com/banner.jpg'],
        pbv2: {
          hasActiveTree: true,
          activeTree: {
            schemaVersion: 1,
            treeJson: {
              rootNodeIds: ['finishingGroup'],
              nodes: {},
            },
            publishedAt: '2024-01-01T00:00:00.000Z',
          },
          hasDraft: false,
        },
      };
      
      const result = productExportV2ItemSchema.safeParse(completeProduct);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pbv2?.hasActiveTree).toBe(true);
        expect(result.data.pbv2?.activeTree?.schemaVersion).toBe(1);
      }
    });
    
    test('rejects invalid pricingMode', () => {
      const invalidProduct = {
        name: 'Test',
        description: 'Test',
        pricingMode: 'invalid',
      };
      
      const result = productExportV2ItemSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });
  });
  
  describe('productsExportV2Schema', () => {
    test('validates complete export payload', () => {
      const exportPayload = {
        schemaVersion: 'products-export/v2' as const,
        exportedAt: '2024-01-01T00:00:00.000Z',
        orgId: 'org_test',
        orgName: 'Test Org',
        products: [
          {
            name: 'Product 1',
            description: 'Description 1',
          },
          {
            name: 'Product 2',
            description: 'Description 2',
            slug: 'product-2',
          },
        ],
        mappings: {
          productTypes: [
            { name: 'Type A', id: 'pt_1' },
          ],
          materials: [
            { sku: 'MAT-001', name: 'Material 1', id: 'mat_1' },
          ],
        },
      };
      
      const result = productsExportV2Schema.safeParse(exportPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.products).toHaveLength(2);
        expect(result.data.mappings?.productTypes).toHaveLength(1);
      }
    });
    
    test('rejects invalid schemaVersion', () => {
      const invalidPayload = {
        schemaVersion: 'products-export/v3',
        exportedAt: '2024-01-01T00:00:00.000Z',
        orgId: 'org_test',
        products: [],
      };
      
      const result = productsExportV2Schema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });
  
  describe('productImportV2RequestSchema', () => {
    test('accepts valid v2 schema version', () => {
      const importRequest = {
        schemaVersion: 'products-export/v2',
        exportedAt: '2024-01-01T00:00:00.000Z',
        orgId: 'org_test',
        products: [],
      };
      
      const result = productImportV2RequestSchema.safeParse(importRequest);
      expect(result.success).toBe(true);
    });
    
    test('rejects invalid schema version format', () => {
      const invalidRequest = {
        schemaVersion: 'invalid-format',
        exportedAt: '2024-01-01T00:00:00.000Z',
        orgId: 'org_test',
        products: [],
      };
      
      const result = productImportV2RequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });
  
  describe('importPlanSchema', () => {
    test('validates import plan with counts and preview', () => {
      const plan = {
        counts: {
          total: 10,
          create: 5,
          update: 3,
          skip: 2,
        },
        warnings: [
          {
            productIndex: 0,
            productName: 'Product A',
            code: 'MATERIAL_NOT_FOUND',
            message: 'Material SKU not found',
            field: 'primaryMaterialSku',
          },
        ],
        errors: [],
        preview: [
          {
            productIndex: 0,
            productName: 'Product A',
            action: 'create' as const,
            reason: 'New product',
          },
          {
            productIndex: 1,
            productName: 'Product B',
            action: 'update' as const,
            existingId: 'prod_123',
            reason: 'Updating existing',
          },
        ],
      };
      
      const result = importPlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.counts.total).toBe(10);
        expect(result.data.warnings).toHaveLength(1);
        expect(result.data.preview).toHaveLength(2);
      }
    });
  });
  
  describe('importResultSchema', () => {
    test('validates successful import result', () => {
      const result = {
        success: true,
        counts: {
          total: 5,
          created: 3,
          updated: 2,
          skipped: 0,
          failed: 0,
        },
        created: [
          { productIndex: 0, productName: 'Product A', productId: 'prod_1' },
          { productIndex: 1, productName: 'Product B', productId: 'prod_2' },
          { productIndex: 2, productName: 'Product C', productId: 'prod_3' },
        ],
        updated: [
          { productIndex: 3, productName: 'Product D', productId: 'prod_4' },
          { productIndex: 4, productName: 'Product E', productId: 'prod_5' },
        ],
        failed: [],
      };
      
      const validation = importResultSchema.safeParse(result);
      expect(validation.success).toBe(true);
      if (validation.success) {
        expect(validation.data.success).toBe(true);
        expect(validation.data.created).toHaveLength(3);
        expect(validation.data.updated).toHaveLength(2);
      }
    });
    
    test('validates partial failure import result', () => {
      const result = {
        success: false,
        counts: {
          total: 3,
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 2,
        },
        created: [
          { productIndex: 0, productName: 'Product A', productId: 'prod_1' },
        ],
        updated: [],
        failed: [
          { 
            productIndex: 1, 
            productName: 'Product B', 
            error: 'Invalid PBV2 tree',
            code: 'INVALID_PBV2_TREE',
          },
          { 
            productIndex: 2, 
            productName: 'Product C', 
            error: 'Duplicate slug',
            code: 'DUPLICATE_PRODUCT',
          },
        ],
      };
      
      const validation = importResultSchema.safeParse(result);
      expect(validation.success).toBe(true);
      if (validation.success) {
        expect(validation.data.success).toBe(false);
        expect(validation.data.failed).toHaveLength(2);
      }
    });
  });
});
