import type { Express } from "express";
import { createServer, type Server } from "http";
import { evaluate } from "mathjs";
import Papa from "papaparse";
import { storage } from "./storage";
import { db } from "./db";
import { customers, users, quotes, orders, invoices, invoiceLineItems, payments, insertMaterialSchema, updateMaterialSchema, insertInventoryAdjustmentSchema, materials, inventoryAdjustments, orderMaterialUsage, accountingSyncJobs } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import * as localAuth from "./localAuth";
import * as replitAuth from "./replitAuth";
// @ts-ignore - NestingCalculator.js is a plain JS file without types
import NestingCalculator from "./NestingCalculator.js";
import { emailService } from "./emailService";
import { ensureCustomerForUser } from "./db/syncUsersToCustomers";
import * as quickbooksService from "./quickbooksService";
import * as syncWorker from "./workers/syncProcessor";

// Use local auth for development, Replit auth for production
const nodeEnv = (process.env.NODE_ENV || '').trim();
console.log('NODE_ENV in routes.ts:', JSON.stringify(nodeEnv));
console.log('Using auth:', nodeEnv === "development" ? 'localAuth' : 'replitAuth');
const auth = nodeEnv === "development" ? localAuth : replitAuth;
const { setupAuth, isAuthenticated, isAdmin } = auth;

// Role-based access control middleware
const isOwner = (req: any, res: any, next: any) => {
  if (req.user?.role === 'owner') {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Owner role required." });
};

const isAdminOrOwner = (req: any, res: any, next: any) => {
  if (req.user?.role === 'owner' || req.user?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Admin or Owner role required." });
};
import {
  insertProductSchema,
  updateProductSchema,
  insertQuoteSchema,
  insertProductOptionSchema,
  updateProductOptionSchema,
  insertProductVariantSchema,
  updateProductVariantSchema,
  insertGlobalVariableSchema,
  updateGlobalVariableSchema,
  insertEmailSettingsSchema,
  updateEmailSettingsSchema,
  insertCompanySettingsSchema,
  updateCompanySettingsSchema,
  insertCustomerSchema,
  updateCustomerSchema,
  insertCustomerContactSchema,
  updateCustomerContactSchema,
  insertCustomerNoteSchema,
  updateCustomerNoteSchema,
  insertCustomerCreditTransactionSchema,
  updateCustomerCreditTransactionSchema,
  insertOrderSchema,
  updateOrderSchema,
  insertOrderLineItemSchema,
  updateOrderLineItemSchema,
  insertInvoiceSchema,
  updateInvoiceSchema,
  insertInvoiceLineItemSchema,
  updateInvoiceLineItemSchema,
  insertPaymentSchema,
  updatePaymentSchema,
  insertShipmentSchema,
  updateShipmentSchema,
  insertVendorSchema,
  updateVendorSchema,
  insertPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  type InsertProduct,
  type UpdateProduct
} from "@shared/schema";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { createInvoiceFromOrder, getInvoiceWithRelations, markInvoiceSent, applyPayment, refreshInvoiceStatus } from './invoicesService';
import { generatePackingSlipHTML, sendShipmentEmail, updateOrderFulfillmentStatus } from './fulfillmentService';

// Helper function to get userId from request user object
// Handles both Replit auth (claims.sub) and local auth (id) formats
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const user = await storage.getUser(userId!);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // User management routes (admin only)
  app.get("/api/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Prevent users from removing their own admin status
      const currentUserId = getUserId(req.user);
      if (id === currentUserId && updates.isAdmin === false) {
        return res.status(400).json({ message: "You cannot remove your own admin status" });
      }

      const user = await storage.updateUser(id, updates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const currentUserId = getUserId(req.user);

      // Prevent users from deleting themselves
      if (id === currentUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }

      await storage.deleteUser(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req: any, res) => {
    const userId = getUserId(req.user);
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        req.path,
      );
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", isAuthenticated, isAdmin, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ 
        method: "PUT",
        url: uploadURL 
      });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  app.post("/api/objects/acl", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { objectPath } = req.body;
      if (typeof objectPath !== 'string' || !objectPath) {
        return res.status(400).json({ message: "objectPath is required" });
      }

      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const objectStorageService = new ObjectStorageService();

      const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
        objectPath,
        {
          owner: userId,
          visibility: "public",
        }
      );

      res.json({ path: normalizedPath });
    } catch (error) {
      console.error("Error setting object ACL:", error);
      res.status(500).json({ message: "Failed to set object ACL" });
    }
  });

  app.get("/api/media", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const assets = await storage.getAllMediaAssets();
      res.json(assets);
    } catch (error) {
      console.error("Error fetching media assets:", error);
      res.status(500).json({ message: "Failed to fetch media assets" });
    }
  });

  app.post("/api/media", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { filename, url, fileSize, mimeType } = req.body;
      
      if (!filename || !url || fileSize === undefined || !mimeType) {
        return res.status(400).json({ message: "filename, url, fileSize, and mimeType are required" });
      }

      const userId = getUserId(req.user);
      const asset = await storage.createMediaAsset({
        filename,
        url,
        uploadedBy: userId!,
        fileSize,
        mimeType,
      });

      res.json(asset);
    } catch (error) {
      console.error("Error creating media asset:", error);
      res.status(500).json({ message: "Failed to create media asset" });
    }
  });

  app.delete("/api/media/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteMediaAsset(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting media asset:", error);
      res.status(500).json({ message: "Failed to delete media asset" });
    }
  });

  // Product Types routes
  app.get("/api/product-types", isAuthenticated, async (req, res) => {
    try {
      const types = await storage.getAllProductTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching product types:", error);
      res.status(500).json({ message: "Failed to fetch product types" });
    }
  });

  app.post("/api/product-types", isAuthenticated, isAdminOrOwner, async (req, res) => {
    try {
      const newType = await storage.createProductType(req.body);
      res.json(newType);
    } catch (error) {
      console.error("Error creating product type:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create product type" });
    }
  });

  app.patch("/api/product-types/:id", isAuthenticated, isAdminOrOwner, async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await storage.updateProductType(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating product type:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to update product type" });
    }
  });

  app.delete("/api/product-types/:id", isAuthenticated, isAdminOrOwner, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteProductType(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting product type:", error);
      if (error.code === '23503') {
        return res.status(400).json({ message: "Cannot delete product type that is in use by products" });
      }
      res.status(500).json({ message: "Failed to delete product type" });
    }
  });

  app.get("/api/products", isAuthenticated, async (req, res) => {
    try {
      const products = await storage.getAllProducts();
      res.json(products);
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

  app.post("/api/products/import", isAuthenticated, isAdmin, async (req, res) => {
    try {
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

          const newProduct = await storage.createProduct({
            name: productName,
            description: row['Product Description']?.trim() || '',
            requiresProductionJob: true,
            pricingFormula: row['Pricing Formula']?.trim() || 'basePrice * quantity',
            variantLabel: row['Variant Label']?.trim(),
            category: row['Category']?.trim(),
            storeUrl: row['Store URL']?.trim(),
            showStoreLink: row['Show Store Link']?.trim().toLowerCase() === 'true',
            thumbnailUrls,
            isActive: row['Is Active']?.trim().toLowerCase() !== 'false',
          });
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

  app.get("/api/products/export", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const products = await storage.getAllProducts();
      
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

  app.get("/api/products/:id", isAuthenticated, async (req, res) => {
    try {
      const product = await storage.getProductById(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsedData = insertProductSchema.parse(req.body);
      const productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null, but preserve null/undefined to let storage handle defaults
        productData[k] = v === '' ? null : v;
      });
      const product = await storage.createProduct(productData as InsertProduct);
      res.json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating product:", error);
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.patch("/api/products/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsedData = updateProductSchema.parse(req.body);
      const productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null, but preserve null/undefined to let storage handle defaults
        productData[k] = v === '' ? null : v;
      });
      const product = await storage.updateProduct(req.params.id, productData as UpdateProduct);
      res.json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  app.put("/api/products/:id/thumbnails", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
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

      const product = await storage.updateProduct(req.params.id, {
        thumbnailUrls: normalizedPaths
      } as UpdateProduct);

      res.json(product);
    } catch (error) {
      console.error("Error updating product thumbnails:", error);
      res.status(500).json({ message: "Failed to update product thumbnails" });
    }
  });

  app.delete("/api/products/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteProduct(req.params.id);
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  app.post("/api/products/:id/clone", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const clonedProduct = await storage.cloneProduct(req.params.id);
      res.json(clonedProduct);
    } catch (error) {
      console.error("Error cloning product:", error);
      res.status(500).json({ message: "Failed to clone product" });
    }
  });

  // Product Options routes
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

  // Product Variants routes
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

  // Global Variables routes
  app.get("/api/global-variables", isAuthenticated, async (req, res) => {
    try {
      const variables = await storage.getAllGlobalVariables();
      res.json(variables);
    } catch (error) {
      console.error("Error fetching global variables:", error);
      res.status(500).json({ message: "Failed to fetch global variables" });
    }
  });

  app.post("/api/global-variables", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const variableData = insertGlobalVariableSchema.parse(req.body);
      const variable = await storage.createGlobalVariable(variableData);
      res.json(variable);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating global variable:", error);
      res.status(500).json({ message: "Failed to create global variable" });
    }
  });

  app.patch("/api/global-variables/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const variableData = updateGlobalVariableSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      
      // Special validation for next_quote_number to prevent duplicate quote numbers
      const currentVariable = await storage.getGlobalVariableById(req.params.id);
      if (currentVariable?.name === 'next_quote_number' && variableData.value !== undefined) {
        const newValue = Math.floor(Number(variableData.value));
        
        // Get the maximum existing quote number
        const maxQuoteNumber = await storage.getMaxQuoteNumber();
        
        if (maxQuoteNumber !== null && newValue <= maxQuoteNumber) {
          return res.status(400).json({ 
            message: `Cannot set next quote number to ${newValue}. The highest existing quote number is ${maxQuoteNumber}. Please set a value greater than ${maxQuoteNumber}.`
          });
        }
      }
      
      const variable = await storage.updateGlobalVariable(req.params.id, variableData);
      res.json(variable);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating global variable:", error);
      res.status(500).json({ message: "Failed to update global variable" });
    }
  });

  app.delete("/api/global-variables/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteGlobalVariable(req.params.id);
      res.json({ message: "Global variable deleted successfully" });
    } catch (error) {
      console.error("Error deleting global variable:", error);
      res.status(500).json({ message: "Failed to delete global variable" });
    }
  });

  app.post("/api/quotes/calculate", isAuthenticated, async (req, res) => {
    try {
      const { productId, variantId, width, height, quantity, selectedOptions = {} } = req.body;

      if (!productId || width == null || height == null || quantity == null) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const product = await storage.getProductById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Fetch product variant if provided
      let variant = null;
      let variantName = null;
      if (variantId) {
        const variants = await storage.getProductVariants(productId);
        variant = variants.find(v => v.id === variantId);
        if (variant) {
          variantName = variant.name;
        }
      }

      // Fetch all global variables for formula evaluation
      const globalVariables = await storage.getAllGlobalVariables();
      const globalVarsContext: Record<string, number> = {};
      globalVariables.forEach(v => {
        globalVarsContext[v.name] = parseFloat(v.value);
      });

      // Coerce inputs to numbers (handles both string and number inputs)
      const widthNum = Number(width);
      const heightNum = Number(height);
      const quantityNum = Number(quantity);

      // Validate input parameters
      if (!Number.isFinite(widthNum) || widthNum <= 0) {
        return res.status(400).json({ message: "Invalid width value" });
      }
      if (!Number.isFinite(heightNum) || heightNum <= 0) {
        return res.status(400).json({ message: "Invalid height value" });
      }
      if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
        return res.status(400).json({ message: "Invalid quantity value" });
      }

      // Calculate square footage
      const sqft = (widthNum * heightNum) / 144; // Convert sq inches to sq feet

      // Build formula context with dimensions, quantity, variant base price, and global variables
      const basePricePerSqft = variant ? parseFloat(variant.basePricePerSqft) : 0;
      const formulaContext: Record<string, number> = {
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
        sqft,
        basePricePerSqft,
        // Single-letter aliases for convenience
        w: widthNum,
        h: heightNum,
        q: quantityNum,
        p: basePricePerSqft, // price per sqft alias
        ...globalVarsContext,
      };

      // Calculate base price using nesting calculator or formula
      let basePrice = 0;
      let nestingDetails: any = undefined;

      console.log(`[PRICING DEBUG] Product: ${product.name}, useNestingCalculator: ${product.useNestingCalculator}, sheetWidth: ${product.sheetWidth}, sheetHeight: ${product.sheetHeight}`);

      if (product.useNestingCalculator && product.sheetWidth && product.sheetHeight) {
        // Use Nesting Calculator
        console.log(`[PRICING DEBUG] Using Nesting Calculator for product ${product.name}`);
        try {
          const sheetWidth = parseFloat(product.sheetWidth);
          const sheetHeight = parseFloat(product.sheetHeight);

          // Calculate sheet cost based on variant price per sqft
          const sheetSqft = (sheetWidth * sheetHeight) / 144;
          const sheetCost = basePricePerSqft * sheetSqft;

          console.log(`[NESTING DEBUG] Sheet: ${sheetWidth}×${sheetHeight}, SqFt: ${sheetSqft}, Price/SqFt: $${basePricePerSqft}, Sheet Cost: $${sheetCost.toFixed(2)}`);

          if (product.materialType === "roll") {
            // Simplified roll calculation (optimize for width only)
            const rollWidth = sheetWidth;
            const piecesAcrossWidth = Math.floor(rollWidth / widthNum);

            if (piecesAcrossWidth === 0) {
              return res.status(400).json({ message: "Piece width exceeds roll width" });
            }

            const linearInchesPerPiece = heightNum;
            const totalLinearInches = Math.ceil(quantityNum / piecesAcrossWidth) * linearInchesPerPiece;
            const linearFeet = totalLinearInches / 12;

            // Price per linear foot from variant
            const pricePerLinearFoot = basePricePerSqft * (rollWidth / 12);
            basePrice = linearFeet * pricePerLinearFoot;

            nestingDetails = {
              piecesAcrossWidth,
              linearFeet: parseFloat(linearFeet.toFixed(2)),
              pattern: `${piecesAcrossWidth} pieces across ${rollWidth}" width`,
              efficiency: 100, // Roll materials don't have waste in the same way
              costPerPiece: parseFloat((basePrice / quantityNum).toFixed(2)),
            };
          } else {
            // Standard sheet nesting using NestingCalculator with waste accounting
            const minPricePerItem = product.minPricePerItem ? parseFloat(product.minPricePerItem) : null;

            // Use variant-level volume pricing if available, otherwise fall back to product-level
            const volumePricing = (variant && variant.volumePricing) ? variant.volumePricing : (product.nestingVolumePricing || null);

            const calc = new NestingCalculator(sheetWidth, sheetHeight, sheetCost, minPricePerItem, volumePricing);
            const pricingResult = calc.calculatePricingWithWaste(widthNum, heightNum, quantityNum);

            // Check for errors (oversized pieces)
            if (pricingResult.error) {
              return res.status(400).json({ message: pricingResult.message });
            }

            basePrice = pricingResult.totalPrice;

            // Build detailed nesting information
            nestingDetails = {
              piecesPerSheet: pricingResult.maxPiecesPerSheet,
              nestingPattern: pricingResult.nestingPattern,
              orientation: pricingResult.orientation,
              sheetWidth: pricingResult.sheetWidth,
              sheetHeight: pricingResult.sheetHeight,
              fullSheets: pricingResult.fullSheets,
              fullSheetsCost: pricingResult.fullSheetsCost,
              remainingPieces: pricingResult.remainingPieces,
              partialSheet: pricingResult.partialSheetDetails,
              totalPrice: pricingResult.totalPrice,
              averageCostPerPiece: pricingResult.averageCostPerPiece,
            };
          }

          // Validate base price is a finite number
          if (!Number.isFinite(basePrice)) {
            console.error("Nesting calculator produced invalid result:", basePrice);
            return res.status(400).json({ message: "Nesting calculation produced an invalid result" });
          }
        } catch (error) {
          console.error("Error in nesting calculator:", error);
          return res.status(400).json({ message: "Nesting calculation failed" });
        }
      } else {
        // Use formula evaluation
        console.log(`[PRICING DEBUG] Using Formula Evaluation for product ${product.name}`);
        if (!product.pricingFormula) {
          return res.status(400).json({ message: "Product must have either a pricing formula or nesting calculator enabled" });
        }

        try {
          const formula = product.pricingFormula;
          console.log(`[PRICING DEBUG] Formula: ${formula}`);
          basePrice = evaluate(formula, formulaContext);

          // Validate base price is a finite number
          if (!Number.isFinite(basePrice)) {
            console.error("Base pricing formula produced invalid result:", basePrice);
            return res.status(400).json({ message: "Product pricing formula produced an invalid result" });
          }
        } catch (error) {
          console.error("Error evaluating formula:", error);
          return res.status(400).json({ message: "Invalid pricing formula" });
        }
      }

      // Fetch product options and calculate option costs
      const productOptions = await storage.getProductOptions(productId);
      let optionsPrice = 0;
      const selectedOptionsArray: Array<{
        optionId: string;
        optionName: string;
        value: string | number | boolean;
        setupCost: number;
        calculatedCost: number;
      }> = [];

      // Build parent-child map to enforce parent toggle states
      const parentChildMap = new Map<string, string[]>();
      productOptions.forEach(opt => {
        if (opt.parentOptionId) {
          if (!parentChildMap.has(opt.parentOptionId)) {
            parentChildMap.set(opt.parentOptionId, []);
          }
          parentChildMap.get(opt.parentOptionId)!.push(opt.id);
        }
      });

      for (const optionId in selectedOptions) {
        const option = productOptions.find(opt => opt.id === optionId);
        if (!option || !option.isActive) continue;

        const value = selectedOptions[optionId];
        
        // Skip if toggle is false or value is null/undefined
        if (option.type === "toggle" && !value) continue;
        if (value === null || value === undefined) continue;

        // For number type, validate that value is finite
        if (option.type === "number") {
          const numValue = parseFloat(value as string);
          if (!Number.isFinite(numValue)) continue;
        }

        // Check if this option has a parent, and if so, verify parent is enabled
        if (option.parentOptionId) {
          const parent = productOptions.find(p => p.id === option.parentOptionId);
          if (parent && parent.type === "toggle") {
            const parentValue = selectedOptions[option.parentOptionId];
            if (!parentValue) continue; // Skip child if parent toggle is off
          }
        }

        // Parse setup cost safely with default to 0
        const setupCost = option.setupCost ? parseFloat(option.setupCost) : 0;
        let calculatedCost = Number.isFinite(setupCost) ? setupCost : 0;

        // Evaluate price formula if provided
        if (option.priceFormula) {
          try {
            let optionCost = 0;
            
            // For select options with string values, use simple conditional parsing
            // This is secure (no code execution) but limited to simple ternary patterns
            if (option.type === "select" && typeof value === "string") {
              // Parse formula pattern: value == "string" ? expr : ... : defaultExpr
              // Extract all condition-expression pairs
              const conditions: Array<{ compareValue: string; expression: string }> = [];
              const pattern = /eqstr\(value,\s*"([^"]+)"\)\s*\?\s*([^:]+?)(?=\s*:\s*eqstr\(value|$)/g;
              
              let match;
              while ((match = pattern.exec(option.priceFormula)) !== null) {
                conditions.push({
                  compareValue: match[1],
                  expression: match[2].trim()
                });
              }
              
              // Find matching condition
              let matched = false;
              for (const condition of conditions) {
                if (value === condition.compareValue) {
                  optionCost = evaluate(condition.expression, formulaContext);
                  matched = true;
                  break;
                }
              }
              
              // If no match, extract and evaluate default (after last colon)
              if (!matched) {
                const lastColonPos = option.priceFormula.lastIndexOf(':');
                if (lastColonPos !== -1) {
                  const defaultExpr = option.priceFormula.substring(lastColonPos + 1).trim();
                  optionCost = evaluate(defaultExpr, formulaContext);
                } else {
                  optionCost = 0;
                }
              }
            } else {
              // For number and toggle options, evaluate with mathjs
              optionCost = evaluate(option.priceFormula, {
                ...formulaContext,
                value: option.type === "number" ? parseFloat(value as string) : value,
              });
            }
            
            // Validate result is a finite number
            if (!Number.isFinite(optionCost)) {
              console.error(`Formula for option ${option.name} produced invalid result: ${optionCost}`);
              return res.status(400).json({ message: `Invalid formula result for option ${option.name}` });
            }
            
            calculatedCost += optionCost;
          } catch (error) {
            console.error(`Error evaluating formula for option ${option.name}:`, error);
            return res.status(400).json({ message: `Invalid formula for option ${option.name}` });
          }
        }

        // Final validation of calculated cost
        if (!Number.isFinite(calculatedCost)) {
          console.error(`Calculated cost for option ${option.name} is invalid: ${calculatedCost}`);
          return res.status(400).json({ message: `Invalid cost calculation for option ${option.name}` });
        }

        optionsPrice += calculatedCost;
        selectedOptionsArray.push({
          optionId: option.id,
          optionName: option.name,
          value,
          setupCost: Number.isFinite(setupCost) ? setupCost : 0,
          calculatedCost,
        });
      }

      let subtotal = basePrice + optionsPrice;
      let priceBreakDiscount = 0;
      let priceBreakInfo: { type: string; tier: string; discount: number } | undefined;

      // Apply price breaks if enabled
      if (product.priceBreaks && typeof product.priceBreaks === 'object') {
        const priceBreaks = product.priceBreaks as any;
        if (priceBreaks.enabled && priceBreaks.tiers && Array.isArray(priceBreaks.tiers)) {
          // Determine the value to compare based on price break type
          let compareValue = 0;
          switch (priceBreaks.type) {
            case "quantity":
              compareValue = quantityNum;
              break;
            case "sheets":
              compareValue = quantityNum; // For sheets, use quantity directly
              break;
            case "sqft":
              compareValue = sqft;
              break;
            default:
              compareValue = quantityNum;
          }

          // Find the applicable tier
          const applicableTier = priceBreaks.tiers
            .filter((tier: any) => {
              const minValue = tier.minValue || 0;
              const maxValue = tier.maxValue;
              return compareValue >= minValue && (maxValue === undefined || maxValue === null || compareValue <= maxValue);
            })
            .sort((a: any, b: any) => (b.minValue || 0) - (a.minValue || 0))[0];

          if (applicableTier) {
            // Apply the discount based on type
            switch (applicableTier.discountType) {
              case "percentage":
                priceBreakDiscount = subtotal * (applicableTier.discountValue / 100);
                break;
              case "fixed":
                priceBreakDiscount = applicableTier.discountValue;
                break;
              case "multiplier":
                subtotal = subtotal * applicableTier.discountValue;
                priceBreakDiscount = 0; // Multiplier is applied directly, not as a discount
                break;
            }

            priceBreakInfo = {
              type: priceBreaks.type,
              tier: `${applicableTier.minValue}${applicableTier.maxValue ? `-${applicableTier.maxValue}` : '+'}`,
              discount: priceBreakDiscount,
            };
          }
        }
      }

      const total = subtotal - priceBreakDiscount;

      // Final validation of total price
      if (!Number.isFinite(total)) {
        console.error("Total price is invalid:", total);
        return res.status(400).json({ message: "Total price calculation produced an invalid result" });
      }

      res.json({
        price: total,
        breakdown: {
          basePrice,
          addOnsPrice: 0, // Deprecated - keeping for backwards compatibility
          optionsPrice,
          subtotal,
          priceBreakDiscount,
          priceBreakInfo,
          total,
          formula: product.pricingFormula,
          selectedOptions: selectedOptionsArray,
          variantInfo: variantName || undefined,
          nestingDetails: nestingDetails || undefined,
        },
        variant: variant ? {
          id: variant.id,
          name: variant.name,
        } : null,
      });
    } catch (error) {
      console.error("Error calculating price:", error);
      res.status(500).json({ message: "Failed to calculate price" });
    }
  });

  app.post("/api/quotes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { customerId, contactId, customerName, source, lineItems } = req.body;

      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }

      // Determine final customerId based on source
      let finalCustomerId = customerId;
      
      if (source === 'customer_quick_quote') {
        // For customer quick quotes, ALWAYS ensure we have a customerId linked to the user
        try {
          finalCustomerId = await ensureCustomerForUser(userId);
          console.log(`[QuoteCreation] Customer quick quote - ensured customerId ${finalCustomerId} for user ${userId}`);
        } catch (error) {
          console.error('[QuoteCreation] Failed to ensure customer for user:', error);
          return res.status(500).json({ 
            message: "Failed to create customer record for quote. Please contact support." 
          });
        }
      } else if (source === 'internal' && !customerId) {
        // For internal quotes, customerId should be provided by the form
        return res.status(400).json({ 
          message: "Customer ID is required for internal quotes. Please select a customer." 
        });
      }

      // Validate each line item
      const validatedLineItems = lineItems.map((item: any) => {
        if (!item.productId || !item.productName || item.width == null || item.height == null || item.quantity == null || item.linePrice == null) {
          throw new Error("Missing required fields in line item");
        }
        
        return {
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId || null,
          variantName: item.variantName || null,
          productType: item.productType || 'wide_roll',
          width: parseFloat(item.width),
          height: parseFloat(item.height),
          quantity: parseInt(item.quantity),
          specsJson: item.specsJson || null,
          selectedOptions: item.selectedOptions || [],
          linePrice: parseFloat(item.linePrice),
          priceBreakdown: item.priceBreakdown || {
            basePrice: parseFloat(item.linePrice),
            optionsPrice: 0,
            total: parseFloat(item.linePrice),
            formula: "",
          },
          displayOrder: item.displayOrder || 0,
        };
      });

      const quote = await storage.createQuote({
        userId,
        customerId: finalCustomerId,
        contactId: contactId || undefined,
        customerName: customerName || undefined,
        source: source || 'internal',
        lineItems: validatedLineItems,
      });
      
      res.json(quote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating quote:", error);
      res.status(500).json({ message: "Failed to create quote" });
    }
  });

  app.get("/api/quotes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const userRole = req.user.role || 'employee';
      const filters = {
        searchCustomer: req.query.searchCustomer as string | undefined,
        searchProduct: req.query.searchProduct as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        minPrice: req.query.minPrice as string | undefined,
        maxPrice: req.query.maxPrice as string | undefined,
        userRole,
        source: req.query.source as string | undefined,
      };

      const quotes = await storage.getUserQuotes(userId, filters);
      res.json(quotes);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  app.get("/api/quotes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;

      // Internal users can access any quote, customers only their own
      const quote = await storage.getQuoteById(id, isInternalUser ? undefined : userId);
      
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      res.json(quote);
    } catch (error) {
      console.error("Error fetching quote:", error);
      res.status(500).json({ message: "Failed to fetch quote" });
    }
  });

  app.patch("/api/quotes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;
      const { customerName, subtotal, taxRate, marginPercentage, discountAmount, totalPrice } = req.body;

      console.log(`[PATCH /api/quotes/${id}] Received update data:`, {
        customerName,
        subtotal,
        taxRate,
        marginPercentage,
        discountAmount,
        totalPrice,
      });

      // Internal users can update any quote, customers only their own
      const existing = await storage.getQuoteById(id, isInternalUser ? undefined : userId);
      if (!existing) {
        return res.status(404).json({ message: "Quote not found" });
      }

      console.log(`[PATCH /api/quotes/${id}] Existing customerName:`, existing.customerName);

      const updatedQuote = await storage.updateQuote(id, {
        customerName,
        subtotal,
        taxRate,
        marginPercentage,
        discountAmount,
        totalPrice,
      });

      console.log(`[PATCH /api/quotes/${id}] Updated customerName:`, updatedQuote.customerName);

      res.json(updatedQuote);
    } catch (error) {
      console.error("Error updating quote:", error);
      res.status(500).json({ message: "Failed to update quote" });
    }
  });

  app.delete("/api/quotes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;

      // Internal users can delete any quote, customers only their own
      const existing = await storage.getQuoteById(id, isInternalUser ? undefined : userId);
      if (!existing) {
        return res.status(404).json({ message: "Quote not found" });
      }

      await storage.deleteQuote(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quote:", error);
      res.status(500).json({ message: "Failed to delete quote" });
    }
  });

  // =============================
  // Quote Workflow / Approval API
  // =============================

  // Get current workflow state for a quote
  app.get("/api/quotes/:id/workflow", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const quote = await storage.getQuoteById(id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });
      const state = await storage.getQuoteWorkflowState(id);
      res.json({ success: true, data: state || null });
    } catch (error) {
      console.error('Error fetching quote workflow state:', error);
      res.status(500).json({ message: 'Failed to fetch workflow state' });
    }
  });

  // Staff request changes
  app.post("/api/quotes/:id/request-changes", isAuthenticated, async (req: any, res) => {
    try {
      const userRole = req.user.role || 'customer';
      if (!['owner','admin','manager'].includes(userRole)) {
        return res.status(403).json({ message: 'Only staff can request changes.' });
      }
      const { id } = req.params;
      const { notes } = req.body;
      const quote = await storage.getQuoteById(id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });
      let state = await storage.getQuoteWorkflowState(id);
      if (!state) {
        state = await storage.createQuoteWorkflowState({ quoteId: id, status: 'change_requested', staffNotes: notes || null });
      } else {
        state = await storage.updateQuoteWorkflowState(id, { status: 'change_requested', staffNotes: notes || null });
      }
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error requesting quote changes:', error);
      res.status(500).json({ message: 'Failed to request changes' });
    }
  });

  // Staff approve quote
  app.post("/api/quotes/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const userRole = req.user.role || 'customer';
      if (!['owner','admin','manager'].includes(userRole)) {
        return res.status(403).json({ message: 'Only staff can approve.' });
      }
      const { id } = req.params;
      const quote = await storage.getQuoteById(id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });
      let state = await storage.getQuoteWorkflowState(id);
      if (!state) {
        state = await storage.createQuoteWorkflowState({ quoteId: id, status: 'staff_approved', approvedByStaffUserId: getUserId(req.user) });
      } else {
        state = await storage.updateQuoteWorkflowState(id, { status: 'staff_approved', approvedByStaffUserId: getUserId(req.user) });
      }
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error approving quote:', error);
      res.status(500).json({ message: 'Failed to approve quote' });
    }
  });

  // Staff reject quote
  app.post("/api/quotes/:id/reject", isAuthenticated, async (req: any, res) => {
    try {
      const userRole = req.user.role || 'customer';
      if (!['owner','admin','manager'].includes(userRole)) {
        return res.status(403).json({ message: 'Only staff can reject.' });
      }
      const { id } = req.params;
      const { reason } = req.body;
      const quote = await storage.getQuoteById(id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });
      let state = await storage.getQuoteWorkflowState(id);
      if (!state) {
        state = await storage.createQuoteWorkflowState({ quoteId: id, status: 'rejected', rejectionReason: reason || null, rejectedByUserId: getUserId(req.user) });
      } else {
        state = await storage.updateQuoteWorkflowState(id, { status: 'rejected', rejectionReason: reason || null, rejectedByUserId: getUserId(req.user) });
      }
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error rejecting quote:', error);
      res.status(500).json({ message: 'Failed to reject quote' });
    }
  });

  app.post("/api/quotes/:id/line-items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;
      const lineItem = req.body;

      // Internal users can add line items to any quote, customers only their own
      const quote = await storage.getQuoteById(id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      // Validate line item
      if (!lineItem.productId || !lineItem.productName || lineItem.width == null || lineItem.height == null || lineItem.quantity == null || lineItem.linePrice == null) {
        return res.status(400).json({ message: "Missing required fields in line item" });
      }

      const validatedLineItem = {
        productId: lineItem.productId,
        productName: lineItem.productName,
        variantId: lineItem.variantId || null,
        variantName: lineItem.variantName || null,
        productType: lineItem.productType || 'wide_roll',
        width: parseFloat(lineItem.width),
        height: parseFloat(lineItem.height),
        quantity: parseInt(lineItem.quantity),
        specsJson: lineItem.specsJson || null,
        selectedOptions: lineItem.selectedOptions || [],
        linePrice: parseFloat(lineItem.linePrice),
        priceBreakdown: lineItem.priceBreakdown || {
          basePrice: parseFloat(lineItem.linePrice),
          optionsPrice: 0,
          total: parseFloat(lineItem.linePrice),
          formula: "",
        },
        displayOrder: lineItem.displayOrder || 0,
      };

      const createdLineItem = await storage.addLineItem(id, validatedLineItem);
      res.json(createdLineItem);
    } catch (error) {
      console.error("Error adding line item:", error);
      res.status(500).json({ message: "Failed to add line item" });
    }
  });

  app.patch("/api/quotes/:id/line-items/:lineItemId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id, lineItemId } = req.params;
      const lineItem = req.body;

      // Internal users can update line items in any quote, customers only their own
      const quote = await storage.getQuoteById(id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const updateData: any = {};
      if (lineItem.productId) updateData.productId = lineItem.productId;
      if (lineItem.productName) updateData.productName = lineItem.productName;
      if (lineItem.variantId !== undefined) updateData.variantId = lineItem.variantId;
      if (lineItem.variantName !== undefined) updateData.variantName = lineItem.variantName;
      if (lineItem.width !== undefined) updateData.width = parseFloat(lineItem.width);
      if (lineItem.height !== undefined) updateData.height = parseFloat(lineItem.height);
      if (lineItem.quantity !== undefined) updateData.quantity = parseInt(lineItem.quantity);
      if (lineItem.selectedOptions !== undefined) updateData.selectedOptions = lineItem.selectedOptions;
      if (lineItem.linePrice !== undefined) updateData.linePrice = parseFloat(lineItem.linePrice);
      if (lineItem.priceBreakdown !== undefined) updateData.priceBreakdown = lineItem.priceBreakdown;
      if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;

      const updatedLineItem = await storage.updateLineItem(lineItemId, updateData);
      res.json(updatedLineItem);
    } catch (error) {
      console.error("Error updating line item:", error);
      res.status(500).json({ message: "Failed to update line item" });
    }
  });

  app.delete("/api/quotes/:id/line-items/:lineItemId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id, lineItemId } = req.params;

      // Internal users can delete line items from any quote, customers only their own
      const quote = await storage.getQuoteById(id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      await storage.deleteLineItem(lineItemId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting line item:", error);
      res.status(500).json({ message: "Failed to delete line item" });
    }
  });

  app.get("/api/admin/quotes", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const filters = {
        searchUser: req.query.searchUser as string | undefined,
        searchCustomer: req.query.searchCustomer as string | undefined,
        searchProduct: req.query.searchProduct as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        minQuantity: req.query.minQuantity as string | undefined,
        maxQuantity: req.query.maxQuantity as string | undefined,
      };

      const quotes = await storage.getAllQuotes(filters);
      res.json(quotes);
    } catch (error) {
      console.error("Error fetching all quotes:", error);
      res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  app.get("/api/admin/quotes/export", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const quotes = await storage.getAllQuotes();

      const csvHeader = "Quote Date,Quote ID,User Email,Customer Name,Product,Variant,Width,Height,Quantity,Selected Options,Options Cost,Line Price,Quote Total\n";
      const csvRows: string[] = [];
      
      quotes.forEach(quote => {
        const date = new Date(quote.createdAt).toISOString().split('T')[0];
        const userEmail = quote.user.email || "N/A";
        const customerName = quote.customerName || "N/A";
        const quoteId = quote.id;
        const quoteTotal = parseFloat(quote.totalPrice).toFixed(2);
        
        // Each line item gets its own row
        quote.lineItems.forEach(lineItem => {
          const product = lineItem.productName;
          const variant = lineItem.variantName || "N/A";
          const width = lineItem.width;
          const height = lineItem.height;
          const quantity = lineItem.quantity;
          const linePrice = parseFloat(lineItem.linePrice).toFixed(2);
          
          // Format selected options for CSV
          let optionsText = "None";
          let optionsCost = "0.00";
          if (lineItem.selectedOptions && Array.isArray(lineItem.selectedOptions) && lineItem.selectedOptions.length > 0) {
            optionsText = lineItem.selectedOptions.map((opt: any) => {
              const value = typeof opt.value === 'boolean' ? (opt.value ? 'Yes' : 'No') : opt.value;
              const cost = opt.calculatedCost ?? 0;
              return `${opt.optionName}: ${value} (+$${cost.toFixed(2)})`;
            }).join('; ');
            
            const totalOptionsCost = lineItem.selectedOptions.reduce((sum: number, opt: any) => {
              return sum + (opt.calculatedCost ?? 0);
            }, 0);
            optionsCost = totalOptionsCost.toFixed(2);
          }

          csvRows.push(`${date},"${quoteId}","${userEmail}","${customerName}","${product}","${variant}",${width},${height},${quantity},"${optionsText}",${optionsCost},${linePrice},${quoteTotal}`);
        });
      });

      const csv = csvHeader + csvRows.join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=quotes-export.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting quotes:", error);
      res.status(500).json({ message: "Failed to export quotes" });
    }
  });

  app.get("/api/pricing-rules", isAuthenticated, async (req, res) => {
    try {
      const rules = await storage.getAllPricingRules();
      res.json(rules);
    } catch (error) {
      console.error("Error fetching pricing rules:", error);
      res.status(500).json({ message: "Failed to fetch pricing rules" });
    }
  });

  // Formula templates routes (admin only)
  app.get("/api/formula-templates", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const templates = await storage.getAllFormulaTemplates();
      console.log(`[DEBUG] Returning ${templates.length} formula templates:`, templates.map(t => ({ id: t.id, name: t.name })));
      res.json(templates);
    } catch (error) {
      console.error("Error fetching formula templates:", error);
      res.status(500).json({ message: "Failed to fetch formula templates" });
    }
  });

  app.get("/api/formula-templates/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const template = await storage.getFormulaTemplateById(id);
      if (!template) {
        return res.status(404).json({ message: "Formula template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error fetching formula template:", error);
      res.status(500).json({ message: "Failed to fetch formula template" });
    }
  });

  app.get("/api/formula-templates/:id/products", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const products = await storage.getProductsByFormulaTemplate(id);
      res.json(products);
    } catch (error) {
      console.error("Error fetching products for formula template:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/formula-templates", isAuthenticated, isAdmin, async (req, res) => {
    try {
      console.log("[DEBUG] Creating formula template with data:", req.body);
      const template = await storage.createFormulaTemplate(req.body);
      console.log("[DEBUG] Created formula template:", { id: template.id, name: template.name });
      res.json(template);
    } catch (error) {
      console.error("Error creating formula template:", error);
      res.status(500).json({ message: "Failed to create formula template" });
    }
  });

  app.patch("/api/formula-templates/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const template = await storage.updateFormulaTemplate(id, req.body);
      res.json(template);
    } catch (error) {
      console.error("Error updating formula template:", error);
      res.status(500).json({ message: "Failed to update formula template" });
    }
  });

  app.delete("/api/formula-templates/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteFormulaTemplate(id);
      res.json({ message: "Formula template deleted successfully" });
    } catch (error) {
      console.error("Error deleting formula template:", error);
      res.status(500).json({ message: "Failed to delete formula template" });
    }
  });

  // Email Settings routes
  app.get("/api/email-settings", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settings = await storage.getAllEmailSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching email settings:", error);
      res.status(500).json({ message: "Failed to fetch email settings" });
    }
  });

  app.get("/api/email-settings/default", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settings = await storage.getDefaultEmailSettings();
      if (!settings) {
        return res.status(404).json({ message: "No default email settings found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching default email settings:", error);
      res.status(500).json({ message: "Failed to fetch default email settings" });
    }
  });

  app.post("/api/email-settings", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settingsData = insertEmailSettingsSchema.parse(req.body);
      const settings = await storage.createEmailSettings(settingsData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating email settings:", error);
      res.status(500).json({ message: "Failed to create email settings" });
    }
  });

  app.patch("/api/email-settings/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settingsData = updateEmailSettingsSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const { id, ...updateData } = settingsData;
      const settings = await storage.updateEmailSettings(req.params.id, updateData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating email settings:", error);
      res.status(500).json({ message: "Failed to update email settings" });
    }
  });

  app.delete("/api/email-settings/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteEmailSettings(req.params.id);
      res.json({ message: "Email settings deleted successfully" });
    } catch (error) {
      console.error("Error deleting email settings:", error);
      res.status(500).json({ message: "Failed to delete email settings" });
    }
  });

  // Email sending routes
  app.post("/api/email/test", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { recipientEmail } = req.body;
      if (!recipientEmail) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      await emailService.sendTestEmail(recipientEmail);
      res.json({ message: "Test email sent successfully" });
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to send test email"
      });
    }
  });

  app.post("/api/quotes/:id/email", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { recipientEmail } = req.body;

      if (!recipientEmail) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      // Verify user has access to this quote
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const quote = await storage.getQuoteById(id, isInternalUser ? undefined : userId);

      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      await emailService.sendQuoteEmail(id, recipientEmail);
      res.json({ message: "Quote email sent successfully" });
    } catch (error) {
      console.error("Error sending quote email:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to send quote email"
      });
    }
  });

  // Company Settings routes
  app.get("/api/company-settings", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settings = await storage.getCompanySettings();
      if (!settings) {
        return res.status(404).json({ message: "Company settings not found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  app.post("/api/company-settings", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settingsData = insertCompanySettingsSchema.parse(req.body);
      const settings = await storage.createCompanySettings(settingsData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating company settings:", error);
      res.status(500).json({ message: "Failed to create company settings" });
    }
  });

  app.patch("/api/company-settings/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settingsData = updateCompanySettingsSchema.parse(req.body);
      const settings = await storage.updateCompanySettings(req.params.id, settingsData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating company settings:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });

  // Global search endpoint
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const results: any[] = [];

      // Search customers
      const customers = await storage.getAllCustomers({ search: query });
      customers.slice(0, 5).forEach((customer: any) => {
        results.push({
          type: "customer",
          id: customer.id,
          title: customer.companyName,
          subtitle: customer.email || customer.phone || undefined,
          url: `/customers/${customer.id}`,
        });
      });

      // Search quotes
      const quotes = await storage.getAllQuotes();
      const matchingQuotes = quotes
        .filter((quote: any) =>
          quote.quoteNumber?.toLowerCase().includes(query.toLowerCase()) ||
          quote.customerName?.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 5);

      matchingQuotes.forEach((quote: any) => {
        results.push({
          type: "quote",
          id: quote.id,
          title: `Quote #${quote.quoteNumber || quote.id.slice(0, 8)}`,
          subtitle: quote.customerName || undefined,
          url: `/edit-quote/${quote.id}`,
        });
      });

      res.json(results);
    } catch (error) {
      console.error("Error performing search:", error);
      res.status(500).json({ message: "Search failed" });
    }
  });

  // Customer routes
  app.get("/api/customers", isAuthenticated, async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        status: req.query.status as string | undefined,
        customerType: req.query.customerType as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const customers = await storage.getAllCustomers(filters);
      
      // Calculate availableCredit for each customer
      const customersWithCredit = customers.map(customer => ({
        ...customer,
        availableCredit: (parseFloat(customer.creditLimit || "0") - parseFloat(customer.currentBalance || "0")).toString(),
      }));
      
      res.json(customersWithCredit);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", isAuthenticated, async (req, res) => {
    try {
      const customer = await storage.getCustomerById(req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", isAuthenticated, async (req: any, res) => {
    try {
      console.log("Received customer data:", req.body);
      const customerData = insertCustomerSchema.parse(req.body);
      console.log("Parsed customer data:", customerData);
      const customer = await storage.createCustomer(customerData);
      console.log("Created customer:", customer);
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Zod validation error:", error.errors);
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.patch("/api/customers/:id", isAuthenticated, async (req, res) => {
    try {
      const customerData = updateCustomerSchema.parse(req.body);
      const customer = await storage.updateCustomer(req.params.id, customerData);
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer:", error);
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteCustomer(req.params.id);
      res.json({ message: "Customer deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer:", error);
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  // Customer Contacts routes
  app.get("/api/customers/:customerId/contacts", isAuthenticated, async (req, res) => {
    try {
      const contacts = await storage.getCustomerContacts(req.params.customerId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching customer contacts:", error);
      res.status(500).json({ message: "Failed to fetch customer contacts" });
    }
  });

  // Global contacts list with search and pagination
  app.get("/api/contacts", isAuthenticated, async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 50;

      const contacts = await storage.getAllContacts({ search, page, pageSize });
      res.json({ contacts, total: contacts.length, page, pageSize });
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  // Contact detail with relations
  app.get("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactWithCustomer = await storage.getContactWithRelations(req.params.id);
      if (!contactWithCustomer) {
        return res.status(404).json({ message: "Contact not found" });
      }

      const { customer, ...contact } = contactWithCustomer;

      // Fetch recent orders for this contact
      const recentOrdersQuery = await db
        .select()
        .from(orders)
        .where(eq(orders.contactId, contact.id))
        .orderBy(desc(orders.createdAt))
        .limit(10);

      // Fetch recent quotes for this contact
      const recentQuotesQuery = await db
        .select()
        .from(quotes)
        .where(eq(quotes.contactId, contact.id))
        .orderBy(desc(quotes.createdAt))
        .limit(10);

      res.json({
        contact,
        customer: customer || null,
        recentOrders: recentOrdersQuery || [],
        recentQuotes: recentQuotesQuery || [],
      });
    } catch (error) {
      console.error("Error fetching contact detail:", error);
      res.status(500).json({ message: "Failed to fetch contact detail" });
    }
  });

  app.post("/api/customers/:customerId/contacts", isAuthenticated, async (req, res) => {
    try {
      const contactData = insertCustomerContactSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
      });
      const contact = await storage.createCustomerContact(contactData);
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer contact:", error);
      res.status(500).json({ message: "Failed to create customer contact" });
    }
  });

  app.patch("/api/customer-contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactData = updateCustomerContactSchema.parse(req.body);
      const contact = await storage.updateCustomerContact(req.params.id, contactData);
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer contact:", error);
      res.status(500).json({ message: "Failed to update customer contact" });
    }
  });

  app.delete("/api/customer-contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const contactId = req.params.id;

      // Get contact details before deletion for audit log
      const contact = await storage.getCustomerContactById(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      // Delete the contact
      await storage.deleteCustomerContact(contactId);

      // Create audit log
      const userId = getUserId(req.user);
      const userName = req.user?.name || req.user?.email || 'Unknown';
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'delete',
        entityType: 'contact',
        entityId: contactId,
        entityName: `${contact.firstName} ${contact.lastName}`,
        description: `Deleted contact ${contact.firstName} ${contact.lastName} (${contact.email || 'no email'})`,
        oldValues: contact,
        newValues: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({ message: "Customer contact deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer contact:", error);
      res.status(500).json({ message: "Failed to delete customer contact" });
    }
  });

  // Customer Notes routes
  app.get("/api/customers/:customerId/notes", isAuthenticated, async (req, res) => {
    try {
      const filters = {
        noteType: req.query.noteType as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const notes = await storage.getCustomerNotes(req.params.customerId, filters);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching customer notes:", error);
      res.status(500).json({ message: "Failed to fetch customer notes" });
    }
  });

  app.post("/api/customers/:customerId/notes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const noteData = insertCustomerNoteSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        createdBy: userId,
      });
      const note = await storage.createCustomerNote(noteData);
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer note:", error);
      res.status(500).json({ message: "Failed to create customer note" });
    }
  });

  app.patch("/api/customer-notes/:id", isAuthenticated, async (req, res) => {
    try {
      const noteData = updateCustomerNoteSchema.parse(req.body);
      const note = await storage.updateCustomerNote(req.params.id, noteData);
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer note:", error);
      res.status(500).json({ message: "Failed to update customer note" });
    }
  });

  app.delete("/api/customer-notes/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCustomerNote(req.params.id);
      res.json({ message: "Customer note deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer note:", error);
      res.status(500).json({ message: "Failed to delete customer note" });
    }
  });

  // Customer Credit Transactions routes
  app.get("/api/customers/:customerId/credit-transactions", isAuthenticated, async (req, res) => {
    try {
      const transactions = await storage.getCustomerCreditTransactions(req.params.customerId);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching customer credit transactions:", error);
      res.status(500).json({ message: "Failed to fetch customer credit transactions" });
    }
  });

  app.post("/api/customers/:customerId/credit-transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const transactionData = insertCustomerCreditTransactionSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        createdBy: userId,
      });
      const transaction = await storage.createCustomerCreditTransaction(transactionData);
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to create customer credit transaction" });
    }
  });

  app.patch("/api/customer-credit-transactions/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const transactionData = updateCustomerCreditTransactionSchema.parse(req.body);
      const transaction = await storage.updateCustomerCreditTransaction(req.params.id, transactionData);
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to update customer credit transaction" });
    }
  });

  app.post("/api/customers/:customerId/apply-credit", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { amount, type, reason } = req.body;

      if (!amount || !type || !reason) {
        return res.status(400).json({ message: "Amount, type, and reason are required" });
      }

      const customer = await storage.updateCustomerBalance(
        req.params.customerId,
        parseFloat(amount),
        type,
        reason,
        userId!
      );
      res.json(customer);
    } catch (error) {
      console.error("Error applying credit to customer:", error);
      res.status(500).json({ message: "Failed to apply credit to customer" });
    }
  });

  // Orders routes
  app.get("/api/orders", isAuthenticated, async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        status: req.query.status as string | undefined,
        priority: req.query.priority as string | undefined,
        customerId: req.query.customerId as string | undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      };
      const orders = await storage.getAllOrders(filters);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", isAuthenticated, async (req, res) => {
    try {
      const order = await storage.getOrderById(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(order);
    } catch (error) {
      console.error("Error fetching order:", error);
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });

  app.post("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Validate the order data (excluding line items for now)
      const { lineItems, ...orderFields } = req.body;
      
      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }

      // Create order with line items
      const order = await storage.createOrder({
        ...orderFields,
        createdByUserId: userId,
        lineItems: lineItems,
      });

      // Create audit log
      await storage.createAuditLog({
        userId,
        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        actionType: 'CREATE',
        entityType: 'order',
        entityId: order.id,
        entityName: order.orderNumber,
        description: `Created order ${order.orderNumber}`,
        newValues: order,
      });

      res.json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Zod validation error:", error.errors);
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating order:", error);
      res.status(500).json({ message: "Failed to create order", error: (error as Error).message });
    }
  });

  app.patch("/api/orders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      
      // Validate customerId if provided
      if (req.body.customerId) {
        const customer = await storage.getCustomerById(req.body.customerId);
        if (!customer) {
          return res.status(400).json({ message: "Invalid customer ID" });
        }
      }
      
      const orderData = updateOrderSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const { id, ...updateData } = orderData;
      
      // Get old values for audit
      const oldOrder = await storage.getOrderById(req.params.id);
      
      // Update order - now returns full OrderWithRelations
      const order = await storage.updateOrder(req.params.id, updateData);

      // Auto inventory deduction when moving to production
      if (userId && oldOrder && oldOrder.status !== 'in_production' && order.status === 'in_production') {
        try {
          await storage.autoDeductInventoryWhenOrderMovesToProduction(order.id, userId);
        } catch (invErr) {
          console.error('Inventory auto-deduction error:', invErr);
          // Do not fail the order update; surface warning
        }
      }

      // Create audit log
      if (userId) {
        await storage.createAuditLog({
          userId,
          userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
          actionType: 'UPDATE',
          entityType: 'order',
          entityId: order.id,
          entityName: order.orderNumber,
          description: `Updated order ${order.orderNumber}`,
          oldValues: oldOrder,
          newValues: order,
        });
      }

      // Return full order with customer data
      res.json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating order:", error);
      res.status(500).json({ message: "Failed to update order" });
    }
  });

  // =============================
  // Inventory Management Routes
  // =============================

  // List materials
  app.get('/api/materials', isAuthenticated, async (req: any, res) => {
    try {
      const list = await storage.getAllMaterials();
      res.json({ success: true, data: list });
    } catch (err) {
      console.error('Error listing materials', err);
      res.status(500).json({ error: 'Failed to list materials' });
    }
  });

  // Low stock alerts
  app.get('/api/materials/low-stock', isAuthenticated, async (req: any, res) => {
    try {
      const alerts = await storage.getMaterialLowStockAlerts();
      res.json({ success: true, data: alerts });
    } catch (err) {
      console.error('Error getting low stock alerts', err);
      res.status(500).json({ error: 'Failed to get low stock alerts' });
    }
  });

  // Get single material
  app.get('/api/materials/:id', isAuthenticated, async (req: any, res) => {
    try {
      const material = await storage.getMaterialById(req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      res.json({ success: true, data: material });
    } catch (err) {
      console.error('Error fetching material', err);
      res.status(500).json({ error: 'Failed to fetch material' });
    }
  });

  // Create material
  app.post('/api/materials', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const parsed = insertMaterialSchema.parse(req.body);
      const created = await storage.createMaterial(parsed);
      res.json({ success: true, data: created });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
      console.error('Error creating material', err);
      res.status(500).json({ error: 'Failed to create material' });
    }
  });

  // Update material
  app.patch('/api/materials/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const parsed = updateMaterialSchema.parse(req.body);
      const updated = await storage.updateMaterial(req.params.id, parsed);
      res.json({ success: true, data: updated });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
      console.error('Error updating material', err);
      res.status(500).json({ error: 'Failed to update material' });
    }
  });

  // Delete material
  app.delete('/api/materials/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      await storage.deleteMaterial(req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting material', err);
      res.status(500).json({ error: 'Failed to delete material' });
    }
  });

  // Adjust inventory (manual)
  app.post('/api/materials/:id/adjust', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const material = await storage.getMaterialById(req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      const parsed = insertInventoryAdjustmentSchema.parse({ ...req.body, materialId: req.params.id });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const adjustment = await storage.adjustInventory(parsed.materialId, parsed.type as any, parsed.quantityChange, userId, parsed.reason || undefined, parsed.orderId || undefined);
      res.json({ success: true, data: adjustment });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
      console.error('Error adjusting inventory', err);
      res.status(500).json({ error: 'Failed to adjust inventory' });
    }
  });

  // List adjustments for a material
  app.get('/api/materials/:id/adjustments', isAuthenticated, async (req: any, res) => {
    try {
      const material = await storage.getMaterialById(req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      const adjustments = await storage.getInventoryAdjustments(req.params.id);
      res.json({ success: true, data: adjustments });
    } catch (err) {
      console.error('Error fetching adjustments', err);
      res.status(500).json({ error: 'Failed to fetch adjustments' });
    }
  });

  // Usage history for a material across orders
  app.get('/api/materials/:id/usage', isAuthenticated, async (req: any, res) => {
    try {
      const material = await storage.getMaterialById(req.params.id);
      if (!material) return res.status(404).json({ error: 'Material not found' });
      const usage = await storage.getMaterialUsageByMaterial(req.params.id);
      res.json({ success: true, data: usage });
    } catch (err) {
      console.error('Error fetching material usage', err);
      res.status(500).json({ error: 'Failed to fetch material usage' });
    }
  });

  // Order material usage listing
  app.get('/api/orders/:id/material-usage', isAuthenticated, async (req: any, res) => {
    try {
      const order = await storage.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const usage = await storage.getMaterialUsageByOrder(req.params.id);
      res.json({ success: true, data: usage });
    } catch (err) {
      console.error('Error fetching material usage', err);
      res.status(500).json({ error: 'Failed to fetch material usage' });
    }
  });

  // Manual trigger for inventory deduction (if needed)
  app.post('/api/orders/:id/deduct-inventory', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const order = await storage.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      await storage.autoDeductInventoryWhenOrderMovesToProduction(order.id, userId);
      const usage = await storage.getMaterialUsageByOrder(order.id);
      res.json({ success: true, data: usage });
    } catch (err) {
      console.error('Error deducting inventory manually', err);
      res.status(500).json({ error: 'Failed to deduct inventory' });
    }
  });

  app.delete("/api/orders/:id", isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const order = await storage.getOrderById(req.params.id);
      
      await storage.deleteOrder(req.params.id);

      // Create audit log
      if (userId && order) {
        await storage.createAuditLog({
          userId,
          userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
          actionType: 'DELETE',
          entityType: 'order',
          entityId: req.params.id,
          entityName: order.orderNumber,
          description: `Deleted order ${order.orderNumber}`,
          oldValues: order,
        });
      }

      res.json({ message: "Order deleted successfully" });
    } catch (error) {
      console.error("Error deleting order:", error);
      res.status(500).json({ message: "Failed to delete order" });
    }
  });

  // Convert quote to order
  app.post("/api/orders/from-quote/:quoteId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { quoteId } = req.params;
      const { dueDate, promisedDate, priority, notesInternal, customerId, contactId } = req.body;
      const userRole = req.user.role || 'employee';

      console.log('[CONVERT QUOTE TO ORDER] Starting conversion:', {
        quoteId,
        userId,
        userRole,
        providedCustomerId: customerId,
        providedContactId: contactId,
        dueDate,
        promisedDate,
        priority,
      });

      // Get the quote to check its source and customerId
      const quote = await storage.getQuoteById(quoteId);
      if (!quote) {
        console.error('[CONVERT QUOTE TO ORDER] Quote not found:', quoteId);
        return res.status(404).json({ message: "Quote not found" });
      }

      console.log('[CONVERT QUOTE TO ORDER] Quote details:', {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        quoteCustomerId: quote.customerId,
        quoteContactId: quote.contactId,
        quoteSource: quote.source,
        lineItemsCount: quote.lineItems?.length || 0,
      });

      let finalCustomerId: string;
      let finalContactId: string | null;

      // Handle customer quick quote differently
      if (quote.source === 'customer_quick_quote') {
        // For customer quick quotes, check if quote already has customerId (new behavior)
        // or fall back to finding customer by userId (preferred) or email
        if (quote.customerId) {
          // New quotes created after fix will already have customerId
          finalCustomerId = quote.customerId;
          finalContactId = null;
          console.log('[CONVERT QUOTE TO ORDER] Using customerId from quote:', finalCustomerId);
        } else if (userRole === 'customer' || !['owner', 'admin', 'manager', 'employee'].includes(userRole)) {
          // Legacy path: Customer user converting their own old quote without customerId
          // Try to find customer by userId first (preferred), then by email
          try {
            finalCustomerId = await ensureCustomerForUser(userId);
            finalContactId = null;
            console.log('[CONVERT QUOTE TO ORDER] Ensured customer for user:', {
              userId,
              customerId: finalCustomerId,
            });
          } catch (error) {
            console.error('[CONVERT QUOTE TO ORDER] Failed to ensure customer for user:', error);
            return res.status(400).json({ 
              message: "Cannot convert quote to order: No customer account found. Please contact support to set up your customer account." 
            });
          }
        } else {
          // Staff converting a customer's quick quote - they must provide customerId
          finalCustomerId = customerId;
          finalContactId = contactId || null;
          if (!finalCustomerId) {
            console.error('[CONVERT QUOTE TO ORDER] Staff must provide customer ID for customer quick quote');
            return res.status(400).json({ message: "Customer ID is required to convert this quote to an order" });
          }
        }
      } else {
        // Internal quote - use customerId from quote or provided value
        finalCustomerId = customerId || quote.customerId;
        finalContactId = contactId || quote.contactId;

        if (!finalCustomerId) {
          console.error('[CONVERT QUOTE TO ORDER] No customer ID for internal quote');
          return res.status(400).json({ 
            message: "This quote is missing a customer. Please edit the quote and select a customer before converting to an order." 
          });
        }
      }

      console.log('[CONVERT QUOTE TO ORDER] Using customer:', {
        customerId: finalCustomerId,
        contactId: finalContactId,
      });

      const order = await storage.convertQuoteToOrder(quoteId, userId, {
        customerId: finalCustomerId,
        contactId: finalContactId || undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        promisedDate: promisedDate ? new Date(promisedDate) : undefined,
        priority,
        notesInternal,
      });

      console.log('[CONVERT QUOTE TO ORDER] Order created successfully:', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        lineItemsCount: order.lineItems?.length || 0,
      });

      // Create audit log
      await storage.createAuditLog({
        userId,
        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        actionType: 'CREATE',
        entityType: 'order',
        entityId: order.id,
        entityName: order.orderNumber,
        description: `Created order ${order.orderNumber} from quote ${quote.quoteNumber}`,
        newValues: order,
      });

      res.json(order);
    } catch (error) {
      console.error("[CONVERT QUOTE TO ORDER] Error:", error);
      console.error("[CONVERT QUOTE TO ORDER] Error stack:", (error as Error).stack);
      res.status(500).json({ message: "Failed to convert quote to order", error: (error as Error).message });
    }
  });

  // =============================
  // Customer Portal Endpoints
  // =============================

  // Customer portal: My Quotes (customer_quick_quote only)
  app.get('/api/portal/my-quotes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const quotes = await storage.getUserQuotes(userId, { userRole: req.user.role, source: 'customer_quick_quote' });
      res.json({ success: true, data: quotes });
    } catch (error) {
      console.error('Error fetching portal quotes:', error);
      res.status(500).json({ error: 'Failed to fetch quotes' });
    }
  });

  // Customer portal: My Orders
  app.get('/api/portal/my-orders', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      // Prefer direct linkage by userId on customers
      const customerRows = await db.select().from(customers).where(eq(customers.userId, userId));
      let customerId = customerRows[0]?.id;
      // Fallback: search by email if not linked yet
      if (!customerId && req.user.email) {
        const emailMatches = await db.select().from(customers).where(eq(customers.email, req.user.email));
        customerId = emailMatches[0]?.id;
      }
      if (!customerId) return res.status(404).json({ error: 'Customer account not found' });
      const orders = await storage.getAllOrders({ customerId });
      res.json({ success: true, data: orders });
    } catch (error) {
      console.error('Error fetching portal orders:', error);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  // Customer portal: Convert quote (confirmation + create order)
  app.post('/api/portal/convert-quote/:id', isAuthenticated, async (req: any, res) => {
    try {
      const quoteId = req.params.id;
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const quote = await storage.getQuoteById(quoteId, userId);
      if (!quote) return res.status(404).json({ error: 'Quote not found' });
      // Ensure workflow state moves to customer_approved before conversion
      const existingState = await storage.getQuoteWorkflowState(quoteId);
      if (!existingState || existingState.status !== 'customer_approved') {
        await storage.updateQuoteWorkflowState(quoteId, { status: 'customer_approved', approvedByCustomerUserId: userId, customerNotes: req.body?.customerNotes || null });
      }
      const order = await storage.convertQuoteToOrder(quoteId, userId, {
        priority: req.body?.priority,
        dueDate: req.body?.dueDate ? new Date(req.body.dueDate) : undefined,
        promisedDate: req.body?.promisedDate ? new Date(req.body.promisedDate) : undefined,
        notesInternal: req.body?.internalNotes,
        customerId: quote.customerId || undefined,
        contactId: quote.contactId || undefined,
      });
      await storage.createOrderAuditLog({
        orderId: order.id,
        userId,
        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        actionType: 'converted_by_customer',
        fromStatus: 'pending_customer_approval',
        toStatus: 'new',
        note: req.body?.note || null,
        metadata: null,
      });
      res.json({ success: true, data: order });
    } catch (error) {
      console.error('Error converting quote (portal):', error);
      res.status(500).json({ error: 'Failed to convert quote' });
    }
  });

  // =============================
  // Order-specific Audit & Files
  // =============================

  // Get order audit trail (append-only)
  app.get('/api/orders/:id/audit', isAuthenticated, async (req: any, res) => {
    try {
      const auditEntries = await storage.getOrderAuditLog(req.params.id);
      res.json({ success: true, data: auditEntries });
    } catch (error) {
      console.error('Error fetching order audit:', error);
      res.status(500).json({ error: 'Failed to fetch audit trail' });
    }
  });

  // Append new audit entry
  app.post('/api/orders/:id/audit', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { actionType, fromStatus, toStatus, note, metadata } = req.body;
      const entry = await storage.createOrderAuditLog({
        orderId: req.params.id,
        userId,
        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        actionType: actionType || 'note_added',
        fromStatus: fromStatus || null,
        toStatus: toStatus || null,
        note: note || null,
        metadata: metadata || null,
      });
      res.json({ success: true, data: entry });
    } catch (error) {
      console.error('Error adding audit entry:', error);
      res.status(500).json({ error: 'Failed to add audit entry' });
    }
  });

  // List order files
  app.get('/api/orders/:id/files', isAuthenticated, async (req: any, res) => {
    try {
      const files = await storage.getOrderAttachments(req.params.id);
      res.json({ success: true, data: files });
    } catch (error) {
      console.error('Error fetching order files:', error);
      res.status(500).json({ error: 'Failed to fetch files' });
    }
  });

  // Attach file metadata (upload handled separately via /api/objects/upload)
  app.post('/api/orders/:id/files', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { fileName, fileUrl, fileSize, mimeType, description, quoteId } = req.body;
      if (!fileName || !fileUrl) {
        return res.status(400).json({ error: 'fileName and fileUrl are required' });
      }
      const attachment = await storage.createOrderAttachment({
        orderId: req.params.id,
        quoteId: quoteId || null,
        uploadedByUserId: userId,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        fileName,
        fileUrl,
        fileSize: fileSize || null,
        mimeType: mimeType || null,
        description: description || null,
      });
      await storage.createOrderAuditLog({
        orderId: req.params.id,
        userId,
        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        actionType: 'file_uploaded',
        fromStatus: null,
        toStatus: null,
        note: `File attached: ${fileName}`,
        metadata: { fileId: attachment.id, fileName: fileName } as any,
      });
      res.json({ success: true, data: attachment });
    } catch (error) {
      console.error('Error attaching file:', error);
      res.status(500).json({ error: 'Failed to attach file' });
    }
  });

  // Order Line Items routes
  app.get("/api/orders/:orderId/line-items", isAuthenticated, async (req, res) => {
    try {
      const lineItems = await storage.getOrderLineItems(req.params.orderId);
      res.json(lineItems);
    } catch (error) {
      console.error("Error fetching order line items:", error);
      res.status(500).json({ message: "Failed to fetch order line items" });
    }
  });

  app.get("/api/order-line-items/:id", isAuthenticated, async (req, res) => {
    try {
      const lineItem = await storage.getOrderLineItemById(req.params.id);
      if (!lineItem) {
        return res.status(404).json({ message: "Order line item not found" });
      }
      res.json(lineItem);
    } catch (error) {
      console.error("Error fetching order line item:", error);
      res.status(500).json({ message: "Failed to fetch order line item" });
    }
  });

  app.post("/api/order-line-items", isAuthenticated, async (req, res) => {
    try {
      const lineItemData = insertOrderLineItemSchema.parse(req.body);
      const lineItem = await storage.createOrderLineItem(lineItemData);
      res.json(lineItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating order line item:", error);
      res.status(500).json({ message: "Failed to create order line item" });
    }
  });

  app.patch("/api/order-line-items/:id", isAuthenticated, async (req, res) => {
    try {
      const lineItemData = updateOrderLineItemSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const { id, ...updateData } = lineItemData;
      const lineItem = await storage.updateOrderLineItem(req.params.id, updateData);
      res.json(lineItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating order line item:", error);
      res.status(500).json({ message: "Failed to update order line item" });
    }
  });

  app.delete("/api/order-line-items/:id", isAuthenticated, isAdminOrOwner, async (req, res) => {
    try {
      await storage.deleteOrderLineItem(req.params.id);
      res.json({ message: "Order line item deleted successfully" });
    } catch (error) {
      console.error("Error deleting order line item:", error);
      res.status(500).json({ message: "Failed to delete order line item" });
    }
  });

  // Audit Logs routes (owner only)
  app.get("/api/audit-logs", isAuthenticated, isOwner, async (req, res) => {
    try {
      const filters: any = {};

      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.actionType) filters.actionType = req.query.actionType as string;
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string, 10);

      const logs = await storage.getAuditLogs(filters);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // Diagnostic route to check user-customer linkage (dev only)
  app.get("/api/debug/user-customer-linkage", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      const allUsers = await db.select().from(users);
      const allCustomers = await db.select().from(customers);
      const sampleQuotes = await db.select().from(quotes).limit(10);

      const userLinkage = allUsers.map(user => {
        const linkedCustomer = allCustomers.find(c => c.userId === user.id);
        const customerByEmail = allCustomers.find(c => c.email?.toLowerCase() === user.email?.toLowerCase());
        return {
          userId: user.id,
          email: user.email,
          role: user.role,
          linkedCustomerId: linkedCustomer?.id || null,
          linkedCustomerName: linkedCustomer?.companyName || null,
          customerByEmailId: customerByEmail?.id || null,
          customerByEmailName: customerByEmail?.companyName || null,
          needsLink: !linkedCustomer && !!customerByEmail,
        };
      });

      const quoteInfo = sampleQuotes.map(q => ({
        id: q.id,
        quoteNumber: q.quoteNumber,
        source: q.source,
        customerId: q.customerId,
        userId: q.userId,
        customerName: q.customerName,
      }));

      res.json({
        summary: {
          totalUsers: allUsers.length,
          totalCustomers: allCustomers.length,
          usersWithLinkedCustomer: userLinkage.filter(u => u.linkedCustomerId).length,
          usersNeedingLink: userLinkage.filter(u => u.needsLink).length,
        },
        userLinkage,
        sampleQuotes: quoteInfo,
      });
    } catch (error) {
      console.error("Error checking linkage:", error);
      res.status(500).json({ message: "Failed to check linkage" });
    }
  });

  // =============================
  // Production Jobs Endpoints
  // =============================

  // ============================================================
  // JOB STATUS CONFIGURATION (Admin Only)
  // ============================================================
  app.get("/api/settings/job-statuses", isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const statuses = await storage.getJobStatuses();
      res.json({ success: true, data: statuses });
    } catch (error) {
      console.error("Error fetching job statuses:", error);
      res.status(500).json({ error: "Failed to fetch job statuses" });
    }
  });

  app.post("/api/settings/job-statuses", isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const status = await storage.createJobStatus(req.body);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error("Error creating job status:", error);
      res.status(500).json({ error: "Failed to create job status" });
    }
  });

  app.patch("/api/settings/job-statuses/:id", isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const status = await storage.updateJobStatus(req.params.id, req.body);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error("Error updating job status:", error);
      res.status(500).json({ error: "Failed to update job status" });
    }
  });

  app.delete("/api/settings/job-statuses/:id", isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      await storage.deleteJobStatus(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting job status:", error);
      res.status(500).json({ error: "Failed to delete job status" });
    }
  });

  // ============================================================
  // JOBS & PRODUCTION WORKFLOW
  // ============================================================

  // List jobs (filterable)
  app.get("/api/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const statusKey = req.query.statusKey as string | undefined;
      const assignedToUserId = req.query.assignedToUserId as string | undefined;
      const orderId = req.query.orderId as string | undefined;
      const jobs = await storage.getJobs({ statusKey, assignedToUserId, orderId });
      res.json({ success: true, data: jobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Get single job detail
  app.get("/api/jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({ success: true, data: job });
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  // Update job (status, assignedTo, notes)
  app.patch("/api/jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const role = req.user?.role || "";
      if (role === 'customer') {
        return res.status(403).json({ message: "Access denied" });
      }
      const updates: any = {};
      if (typeof req.body?.statusKey === 'string') updates.statusKey = req.body.statusKey;
      if (typeof req.body?.assignedTo === 'string') updates.assignedTo = req.body.assignedTo;
      if (typeof req.body?.notes === 'string') updates.notes = req.body.notes;
      const userId = req.user?.claims?.sub || req.user?.id || undefined;
      const updated = await storage.updateJob(req.params.id, updates, userId);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("Error updating job:", error);
      res.status(500).json({ error: "Failed to update job" });
    }
  });

  // Append a job note
  app.post("/api/jobs/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const role = req.user?.role || "";
      if (role === 'customer') {
        return res.status(403).json({ message: "Access denied" });
      }
      const noteText = (req.body?.noteText || '').toString();
      if (!noteText) return res.status(400).json({ message: "noteText required" });
      const userId = req.user?.claims?.sub || req.user?.id;
      const note = await storage.addJobNote(req.params.id, noteText, userId);
      res.json({ success: true, data: note });
    } catch (error) {
      console.error("Error adding job note:", error);
      res.status(500).json({ error: "Failed to add job note" });
    }
  });

  // ============================================================
  // INVOICES & PAYMENTS
  // ============================================================

  // List invoices with basic filters
  app.get('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const status = req.query.status as string | undefined;
      const customerId = req.query.customerId as string | undefined;
      const orderId = req.query.orderId as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
      const offset = parseInt(req.query.offset as string || '0', 10);
      // Simple query; refine later for search/sort/pagination
      let rows = await db.select().from(invoices).limit(limit).offset(offset).orderBy(invoices.issueDate);
      if (status) rows = rows.filter(r => r.status === status);
      if (customerId) rows = rows.filter(r => r.customerId === customerId);
      if (orderId) rows = rows.filter(r => r.orderId === orderId);
      // Refresh overdue status on fetch (lazy evaluation)
      const now = new Date();
      const updatedStatusRows = await Promise.all(rows.map(async inv => {
        if (inv.status !== 'paid' && inv.dueDate && new Date(inv.dueDate) < now && inv.status !== 'overdue') {
          await refreshInvoiceStatus(inv.id);
          const rel = await getInvoiceWithRelations(inv.id);
          return rel?.invoice || inv;
        }
        return inv;
      }));
      res.json({ success: true, data: updatedStatusRows });
    } catch (error) {
      console.error('Error listing invoices:', error);
      res.status(500).json({ error: 'Failed to list invoices' });
    }
  });

  // Create invoice from order
  app.post('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { orderId, terms, customDueDate } = req.body || {};
      if (!orderId) return res.status(400).json({ error: 'orderId required for now (manual invoices unsupported)' });
      const invoice = await createInvoiceFromOrder(orderId, userId!, { terms: terms || 'due_on_receipt', customDueDate: customDueDate ? new Date(customDueDate) : null });
      res.json({ success: true, data: invoice });
    } catch (error: any) {
      console.error('Error creating invoice:', error);
      res.status(500).json({ error: error.message || 'Failed to create invoice' });
    }
  });

  // Get invoice detail
  app.get('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      // Ensure status freshness
      await refreshInvoiceStatus(req.params.id);
      const refreshed = await getInvoiceWithRelations(req.params.id);
      res.json({ success: true, data: refreshed });
    } catch (error) {
      console.error('Error fetching invoice:', error);
      res.status(500).json({ error: 'Failed to fetch invoice' });
    }
  });

  // Update invoice (limited fields)
  app.patch('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const existingRel = await getInvoiceWithRelations(id);
      if (!existingRel) return res.status(404).json({ error: 'Invoice not found' });
      const existing = existingRel.invoice;
      const updates: any = {};
      if (typeof req.body.notesPublic === 'string') updates.notesPublic = req.body.notesPublic;
      if (typeof req.body.notesInternal === 'string') updates.notesInternal = req.body.notesInternal;
      if (typeof req.body.terms === 'string') updates.terms = req.body.terms;
      if (req.body.customDueDate) updates.dueDate = new Date(req.body.customDueDate);
      if (updates.terms && updates.terms !== existing.terms) {
        // Recompute dueDate if changing terms and not custom
        if (updates.terms !== 'custom') {
          const issueDate = new Date(existing.issueDate);
          const offsetMap: Record<string, number> = { due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45 };
          const offset = offsetMap[updates.terms] ?? 0;
          const d = new Date(issueDate.getTime());
          d.setDate(d.getDate() + offset);
          updates.dueDate = d;
        }
      }
      const [updated] = await db.update(invoices).set({ ...updates, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating invoice:', error);
      res.status(500).json({ error: 'Failed to update invoice' });
    }
  });

  // Delete invoice (only if draft & no payments)
  app.delete('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      if (rel.invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be deleted' });
      if (rel.payments.length > 0) return res.status(400).json({ error: 'Cannot delete invoice with payments' });
      await db.delete(invoices).where(eq(invoices.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting invoice:', error);
      res.status(500).json({ error: 'Failed to delete invoice' });
    }
  });

  // Mark sent
  app.post('/api/invoices/:id/mark-sent', isAuthenticated, async (req: any, res) => {
    try {
      const updated = await markInvoiceSent(req.params.id);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error marking sent:', error);
      res.status(500).json({ error: 'Failed to mark invoice sent' });
    }
  });

  // Send invoice via email (basic HTML - PDF stub)
  app.post('/api/invoices/:id/send', isAuthenticated, async (req: any, res) => {
    try {
      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const { invoice, lineItems, payments: paymentRows } = rel;
      const customer = await storage.getCustomerById(invoice.customerId);
      const toEmail = customer?.email || req.body.toEmail;
      if (!toEmail) return res.status(400).json({ error: 'No recipient email' });
      const html = `<!DOCTYPE html><html><body><h2>Invoice #${invoice.invoiceNumber}</h2><p>Status: ${invoice.status}</p><p>Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}</p><p>Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}</p><h3>Line Items</h3><table cellpadding="4" border="1" style="border-collapse:collapse"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${lineItems.map(li => `<tr><td>${li.description}</td><td>${li.quantity}</td><td>${li.unitPrice}</td><td>${li.totalPrice}</td></tr>`).join('')}</tbody></table><p>Subtotal: ${invoice.subtotal}</p><p>Tax: ${invoice.tax}</p><p>Total: ${invoice.total}</p><p>Paid: ${invoice.amountPaid}</p><p>Balance Due: ${invoice.balanceDue}</p><h4>Payments</h4>${paymentRows.length ? paymentRows.map(p => `<div>${p.method}: ${p.amount} on ${new Date(p.appliedAt).toLocaleDateString()}</div>`).join('') : '<p>No payments recorded.</p>'}</body></html>`;
      await emailService.sendEmail({ to: toEmail, subject: `Invoice #${invoice.invoiceNumber}`, html });
      await markInvoiceSent(invoice.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error sending invoice:', error);
      res.status(500).json({ error: 'Failed to send invoice' });
    }
  });

  // Apply payment
  app.post('/api/payments', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { invoiceId, amount, method, notes } = req.body || {};
      if (!invoiceId || !amount || !method) return res.status(400).json({ error: 'invoiceId, amount, method required' });
      const payment = await applyPayment(invoiceId, userId!, { amount: Number(amount), method, notes });
      res.json({ success: true, data: payment });
    } catch (error: any) {
      console.error('Error applying payment:', error);
      res.status(500).json({ error: error.message || 'Failed to apply payment' });
    }
  });

  // Payment deletion (only if invoice not fully paid yet)
  app.delete('/api/payments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const paymentId = req.params.id;
      const paymentRows = await db.select().from(payments).where(eq(payments.id, paymentId));
      const payment = paymentRows[0];
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      const rel = await getInvoiceWithRelations(payment.invoiceId);
      if (!rel) return res.status(404).json({ error: 'Parent invoice not found' });
      if (rel.invoice.status === 'paid') return res.status(400).json({ error: 'Cannot delete payment from fully paid invoice' });
      await db.delete(payments).where(eq(payments.id, paymentId));
      await refreshInvoiceStatus(payment.invoiceId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting payment:', error);
      res.status(500).json({ error: 'Failed to delete payment' });
    }
  });

  // Refresh invoice status manually
  app.post('/api/invoices/:id/refresh-status', isAuthenticated, async (req: any, res) => {
    try {
      const updated = await refreshInvoiceStatus(req.params.id);
      if (!updated) return res.status(404).json({ error: 'Invoice not found' });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error refreshing status:', error);
      res.status(500).json({ error: 'Failed to refresh status' });
    }
  });

  // ===== SHIPMENT & FULFILLMENT ROUTES =====

  // Get all shipments for an order
  app.get('/api/orders/:id/shipments', isAuthenticated, async (req: any, res) => {
    try {
      const shipmentList = await storage.getShipmentsByOrder(req.params.id);
      res.json({ success: true, data: shipmentList });
    } catch (error) {
      console.error('Error fetching shipments:', error);
      res.status(500).json({ error: 'Failed to fetch shipments' });
    }
  });

  // Create a new shipment (auto-updates order status to "shipped")
  app.post('/api/orders/:id/shipments', isAuthenticated, async (req: any, res) => {
    try {
      const shipmentData = insertShipmentSchema.parse({
        ...req.body,
        orderId: req.params.id,
        createdByUserId: req.user.id,
      });

      const newShipment = await storage.createShipment(shipmentData);

      // Optionally send shipment notification email
      if (req.body.sendEmail) {
        await sendShipmentEmail(req.params.id, newShipment.id.toString(), req.body.emailSubject, req.body.emailMessage);
      }

      res.json({ success: true, data: newShipment });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid shipment data', details: error.errors });
      }
      console.error('Error creating shipment:', error);
      res.status(500).json({ error: 'Failed to create shipment' });
    }
  });

  // Update a shipment (auto-updates order status to "delivered" if deliveredAt is set)
  app.patch('/api/shipments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const shipmentId = req.params.id;
      const updates = updateShipmentSchema.parse(req.body);
      
      const updated = await storage.updateShipment(shipmentId, updates);
      if (!updated) return res.status(404).json({ error: 'Shipment not found' });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid shipment data', details: error.errors });
      }
      console.error('Error updating shipment:', error);
      res.status(500).json({ error: 'Failed to update shipment' });
    }
  });

  // Delete a shipment (admin/owner only)
  app.delete('/api/shipments/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const shipmentId = req.params.id;
      await storage.deleteShipment(shipmentId);

      res.json({ success: true, message: 'Shipment deleted successfully' });
    } catch (error) {
      console.error('Error deleting shipment:', error);
      res.status(500).json({ error: 'Failed to delete shipment' });
    }
  });

  // Generate packing slip HTML for an order
  app.post('/api/orders/:id/packing-slip', isAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const html = await generatePackingSlipHTML(orderId);
      res.json({ success: true, data: { html } });
    } catch (error) {
      console.error('Error generating packing slip:', error);
      res.status(500).json({ error: 'Failed to generate packing slip' });
    }
  });

  // Send shipment notification email
  app.post('/api/orders/:id/send-shipping-email', isAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const { shipmentId, subject, customMessage } = req.body;

      if (!shipmentId) {
        return res.status(400).json({ error: 'shipmentId is required' });
      }

      await sendShipmentEmail(orderId, shipmentId.toString(), subject, customMessage);
      res.json({ success: true, message: 'Shipment email sent successfully' });
    } catch (error) {
      console.error('Error sending shipment email:', error);
      res.status(500).json({ error: 'Failed to send shipment email' });
    }
  });

  // Manually update order fulfillment status (override auto-status - manager+ only)
  app.patch('/api/orders/:id/fulfillment-status', isAuthenticated, async (req: any, res) => {
    try {
      // Check role
      if (!['owner', 'admin', 'manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Manager, Admin, or Owner role required' });
      }

      const orderId = req.params.id;
      const { status } = req.body;

      if (!['pending', 'packed', 'shipped', 'delivered'].includes(status)) {
        return res.status(400).json({ error: 'Invalid fulfillment status' });
      }

      await updateOrderFulfillmentStatus(orderId, status);

      res.json({ success: true, message: 'Fulfillment status updated successfully' });
    } catch (error) {
      console.error('Error updating fulfillment status:', error);
      res.status(500).json({ error: 'Failed to update fulfillment status' });
    }
  });

  // =============================
  // Vendor Routes
  // =============================
  app.get('/api/vendors', isAuthenticated, async (req: any, res) => {
    try {
      const { search, isActive, page, pageSize } = req.query;
      const vendors = await storage.getVendors({
        search: typeof search === 'string' ? search : undefined,
        isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
      res.json({ success: true, data: vendors });
    } catch (error) {
      console.error('[VENDORS LIST] Error:', error);
      res.status(500).json({ error: 'Failed to fetch vendors' });
    }
  });

  app.get('/api/vendors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const vendor = await storage.getVendorById(req.params.id);
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      res.json({ success: true, data: vendor });
    } catch (error) {
      console.error('[VENDOR GET] Error:', error);
      res.status(500).json({ error: 'Failed to fetch vendor' });
    }
  });

  app.post('/api/vendors', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const parsed = insertVendorSchema.parse(req.body);
      const created = await storage.createVendor(parsed);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'CREATE',
        entityType: 'vendor',
        entityId: created.id,
        entityName: created.name,
        description: `Created vendor ${created.name}`,
        newValues: created,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: created });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid vendor data', details: error.errors });
      }
      console.error('[VENDOR CREATE] Error:', error);
      res.status(500).json({ error: 'Failed to create vendor' });
    }
  });

  app.patch('/api/vendors/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const updates = updateVendorSchema.partial ? updateVendorSchema.partial().parse(req.body) : updateVendorSchema.parse(req.body);
      const existing = await storage.getVendorById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Vendor not found' });
      const updated = await storage.updateVendor(req.params.id, updates);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'UPDATE',
        entityType: 'vendor',
        entityId: updated.id,
        entityName: updated.name,
        description: `Updated vendor ${updated.name}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid vendor update data', details: error.errors });
      }
      console.error('[VENDOR UPDATE] Error:', error);
      res.status(500).json({ error: 'Failed to update vendor' });
    }
  });

  app.delete('/api/vendors/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const existing = await storage.getVendorById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Vendor not found' });
      await storage.deleteVendor(req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'DELETE',
        entityType: 'vendor',
        entityId: existing.id,
        entityName: existing.name,
        description: `Deleted (or deactivated) vendor ${existing.name}`,
        oldValues: existing,
        newValues: null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[VENDOR DELETE] Error:', error);
      res.status(500).json({ error: 'Failed to delete vendor' });
    }
  });

  // =============================
  // Purchase Order Routes
  // =============================
  app.get('/api/purchase-orders', isAuthenticated, async (req: any, res) => {
    try {
      const { vendorId, status, search, startDate, endDate } = req.query;
      const pos = await storage.getPurchaseOrders({
        vendorId: typeof vendorId === 'string' ? vendorId : undefined,
        status: typeof status === 'string' ? status : undefined,
        search: typeof search === 'string' ? search : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });
      res.json({ success: true, data: pos });
    } catch (error) {
      console.error('[PO LIST] Error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase orders' });
    }
  });

  app.get('/api/purchase-orders/:id', isAuthenticated, async (req: any, res) => {
    try {
      const po = await storage.getPurchaseOrderWithLines(req.params.id);
      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      res.json({ success: true, data: po });
    } catch (error) {
      console.error('[PO GET] Error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase order' });
    }
  });

  app.post('/api/purchase-orders', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const parsed = insertPurchaseOrderSchema.parse(req.body);
      const userId = getUserId(req.user);
      const created = await storage.createPurchaseOrder({ ...parsed, createdByUserId: userId! });
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'CREATE',
        entityType: 'purchase_order',
        entityId: created.id,
        entityName: created.poNumber,
        description: `Created PO ${created.poNumber}`,
        newValues: created,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: created });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        console.error('[PO CREATE] Zod validation error:', JSON.stringify(error.errors, null, 2));
        console.error('[PO CREATE] Request body:', JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: 'Invalid purchase order data', details: error.errors });
      }
      console.error('[PO CREATE] Error:', error);
      res.status(500).json({ error: 'Failed to create purchase order' });
    }
  });

  app.patch('/api/purchase-orders/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const updates = updatePurchaseOrderSchema.parse(req.body);
      const existing = await storage.getPurchaseOrderWithLines(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      const updated = await storage.updatePurchaseOrder(req.params.id, updates as any);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'UPDATE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Updated PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid purchase order update data', details: error.errors });
      }
      console.error('[PO UPDATE] Error:', error);
      res.status(500).json({ error: 'Failed to update purchase order' });
    }
  });

  app.delete('/api/purchase-orders/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const existing = await storage.getPurchaseOrderWithLines(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      await storage.deletePurchaseOrder(req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'DELETE',
        entityType: 'purchase_order',
        entityId: existing.id,
        entityName: existing.poNumber,
        description: `Deleted draft PO ${existing.poNumber}`,
        oldValues: existing,
        newValues: null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[PO DELETE] Error:', error);
      res.status(500).json({ error: 'Failed to delete purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/send', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const existing = await storage.getPurchaseOrderWithLines(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft POs can be sent' });
      const updated = await storage.sendPurchaseOrder(req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'SEND',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Sent PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('[PO SEND] Error:', error);
      res.status(500).json({ error: 'Failed to send purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/receive', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const itemsSchema = z.object({
        items: z.array(z.object({
          lineItemId: z.string(),
          quantityToReceive: z.number().positive(),
          receivedDate: z.string().optional(),
        }))
      });
      const parsed = itemsSchema.parse(req.body);
      const existing = await storage.getPurchaseOrderWithLines(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      const userId = getUserId(req.user);
      const receiveItems = parsed.items.map(i => ({
        lineItemId: i.lineItemId,
        quantityToReceive: i.quantityToReceive,
        receivedDate: i.receivedDate ? new Date(i.receivedDate) : undefined,
      }));
      const updated = await storage.receivePurchaseOrderLines(req.params.id, receiveItems, userId!);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog({
        userId,
        userName,
        actionType: 'RECEIVE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Received items for PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid receive data', details: error.errors });
      }
      console.error('[PO RECEIVE] Error:', error);
      res.status(500).json({ error: 'Failed to receive purchase order items' });
    }
  });

  // ==================== QuickBooks Integration Routes ====================

  /**
   * GET /api/integrations/quickbooks/status
   * Check QuickBooks connection status
   */
  app.get('/api/integrations/quickbooks/status', isAuthenticated, async (req: any, res) => {
    try {
      const connection = await quickbooksService.getActiveConnection();
      
      if (!connection) {
        return res.json({ 
          connected: false,
          message: 'QuickBooks not connected'
        });
      }

      // Check if token is still valid
      const validToken = await quickbooksService.getValidAccessToken();
      
      res.json({
        connected: !!validToken,
        companyId: connection.companyId,
        connectedAt: connection.createdAt,
        expiresAt: connection.expiresAt,
      });
    } catch (error: any) {
      console.error('[QB Status] Error:', error);
      res.status(500).json({ error: 'Failed to check QuickBooks status' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/auth-url
   * Get OAuth authorization URL to redirect user to QuickBooks
   */
  app.get('/api/integrations/quickbooks/auth-url', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const authUrl = await quickbooksService.getAuthorizationUrl();
      res.json({ authUrl });
    } catch (error: any) {
      console.error('[QB Auth URL] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate auth URL' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/callback
   * OAuth callback endpoint - QuickBooks redirects here after user authorizes
   */
  app.get('/api/integrations/quickbooks/callback', async (req: any, res) => {
    try {
      const { code, realmId, state, error: authError } = req.query;

      if (authError) {
        console.error('[QB Callback] OAuth error:', authError);
        return res.redirect('/settings?qb_error=' + encodeURIComponent(authError));
      }

      if (!code || !realmId) {
        return res.status(400).json({ error: 'Missing authorization code or realmId' });
      }

      // Exchange code for tokens
      await quickbooksService.exchangeCodeForTokens(code as string, realmId as string);

      // Redirect to settings page with success
      res.redirect('/settings?qb_connected=true');
    } catch (error: any) {
      console.error('[QB Callback] Error:', error);
      res.redirect('/settings?qb_error=' + encodeURIComponent(error.message));
    }
  });

  /**
   * POST /api/integrations/quickbooks/disconnect
   * Disconnect QuickBooks integration
   */
  app.post('/api/integrations/quickbooks/disconnect', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      await quickbooksService.disconnectConnection();
      res.json({ success: true, message: 'QuickBooks disconnected' });
    } catch (error: any) {
      console.error('[QB Disconnect] Error:', error);
      res.status(500).json({ error: 'Failed to disconnect QuickBooks' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/sync/pull
   * Queue pull sync jobs to fetch data FROM QuickBooks
   * Body: { resources: ['customers', 'invoices', 'orders'] }
   */
  app.post('/api/integrations/quickbooks/sync/pull', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const { resources } = req.body;

      if (!Array.isArray(resources) || resources.length === 0) {
        return res.status(400).json({ error: 'Resources array required' });
      }

      const validResources = ['customers', 'invoices', 'orders'];
      const invalidResources = resources.filter((r: string) => !validResources.includes(r));
      
      if (invalidResources.length > 0) {
        return res.status(400).json({ 
          error: `Invalid resources: ${invalidResources.join(', ')}`,
          validResources 
        });
      }

      await quickbooksService.queueSyncJobs('pull', resources);

      res.json({ 
        success: true, 
        message: `Queued ${resources.length} pull sync job(s)`,
        resources 
      });
    } catch (error: any) {
      console.error('[QB Pull Sync] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to queue pull sync' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/sync/push
   * Queue push sync jobs to send data TO QuickBooks
   * Body: { resources: ['customers', 'invoices', 'orders'] }
   */
  app.post('/api/integrations/quickbooks/sync/push', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const { resources } = req.body;

      if (!Array.isArray(resources) || resources.length === 0) {
        return res.status(400).json({ error: 'Resources array required' });
      }

      const validResources = ['customers', 'invoices', 'orders'];
      const invalidResources = resources.filter((r: string) => !validResources.includes(r));
      
      if (invalidResources.length > 0) {
        return res.status(400).json({ 
          error: `Invalid resources: ${invalidResources.join(', ')}`,
          validResources 
        });
      }

      await quickbooksService.queueSyncJobs('push', resources);

      res.json({ 
        success: true, 
        message: `Queued ${resources.length} push sync job(s)`,
        resources 
      });
    } catch (error: any) {
      console.error('[QB Push Sync] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to queue push sync' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/jobs
   * Get list of sync jobs with status
   */
  app.get('/api/integrations/quickbooks/jobs', isAuthenticated, async (req: any, res) => {
    try {
      const { status, limit = 50 } = req.query;

      let query = db.select().from(accountingSyncJobs);

      if (status) {
        query = query.where(eq(accountingSyncJobs.status, status)) as any;
      }

      const jobs = await query
        .orderBy(desc(accountingSyncJobs.createdAt))
        .limit(parseInt(limit as string, 10));

      res.json({ jobs });
    } catch (error: any) {
      console.error('[QB Jobs] Error:', error);
      res.status(500).json({ error: 'Failed to fetch sync jobs' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/jobs/:id
   * Get specific sync job details
   */
  app.get('/api/integrations/quickbooks/jobs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const [job] = await db
        .select()
        .from(accountingSyncJobs)
        .where(eq(accountingSyncJobs.id, req.params.id))
        .limit(1);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({ job });
    } catch (error: any) {
      console.error('[QB Job Detail] Error:', error);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/jobs/trigger
   * Manually trigger sync worker to process pending jobs
   */
  app.post('/api/integrations/quickbooks/jobs/trigger', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      // Trigger worker processing (non-blocking)
      syncWorker.triggerJobProcessing().catch((error) => {
        console.error('[QB Manual Trigger] Error:', error);
      });

      res.json({ 
        success: true, 
        message: 'Sync job processing triggered' 
      });
    } catch (error: any) {
      console.error('[QB Manual Trigger] Error:', error);
      res.status(500).json({ error: 'Failed to trigger sync' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/worker/status
   * Get sync worker status
   */
  app.get('/api/integrations/quickbooks/worker/status', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const status = syncWorker.getWorkerStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[QB Worker Status] Error:', error);
      res.status(500).json({ error: 'Failed to get worker status' });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
