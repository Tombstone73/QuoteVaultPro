import type { Express } from "express";
import { createServer, type Server } from "http";
import { evaluate } from "mathjs";
import Papa from "papaparse";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
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

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req: any, res) => {
    const userId = req.user?.claims?.sub;
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

      const userId = req.user.claims.sub;
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

      const userId = req.user.claims.sub;
      const asset = await storage.createMediaAsset({
        filename,
        url,
        uploadedBy: userId,
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
            description: row['Product Description']?.trim() || null,
            pricingFormula: row['Pricing Formula']?.trim() || 'basePrice * quantity',
            variantLabel: row['Variant Label']?.trim() || null,
            category: row['Category']?.trim() || null,
            storeUrl: row['Store URL']?.trim() || null,
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

      const userId = req.user.claims.sub;
      const objectStorageService = new ObjectStorageService();
      const normalizedPaths: string[] = [];

      for (const rawPath of thumbnailUrls) {
        if (typeof rawPath !== 'string' || !rawPath) continue;
        
        const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
          rawPath,
          {
            owner: userId,
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
      const formulaContext: Record<string, number> = {
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
        sqft,
        basePricePerSqft: variant ? parseFloat(variant.basePricePerSqft) : 0,
        ...globalVarsContext,
      };

      // Safely evaluate base price using mathjs
      let basePrice = 0;
      try {
        const formula = product.pricingFormula;
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

      const total = basePrice + optionsPrice;

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
          total,
          formula: product.pricingFormula,
          selectedOptions: selectedOptionsArray,
          variantInfo: variantName || undefined,
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
      const userId = req.user.claims.sub;
      const { customerName, lineItems } = req.body;

      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
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
          width: parseFloat(item.width),
          height: parseFloat(item.height),
          quantity: parseInt(item.quantity),
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
        customerName: customerName || undefined,
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
      const userId = req.user.claims.sub;
      const filters = {
        searchCustomer: req.query.searchCustomer as string | undefined,
        searchProduct: req.query.searchProduct as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        minPrice: req.query.minPrice as string | undefined,
        maxPrice: req.query.maxPrice as string | undefined,
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
      const userId = req.user.claims.sub;
      const userIsAdmin = req.user.role === 'admin';
      const { id } = req.params;

      // Admins can access any quote, regular users only their own
      const quote = await storage.getQuoteById(id, userIsAdmin ? undefined : userId);
      
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
      const userId = req.user.claims.sub;
      const userIsAdmin = req.user.role === 'admin';
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

      // Admins can update any quote, regular users only their own
      const existing = await storage.getQuoteById(id, userIsAdmin ? undefined : userId);
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
      const userId = req.user.claims.sub;
      const userIsAdmin = req.user.role === 'admin';
      const { id } = req.params;

      // Admins can delete any quote, regular users only their own
      const existing = await storage.getQuoteById(id, userIsAdmin ? undefined : userId);
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

  app.post("/api/quotes/:id/line-items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userIsAdmin = req.user.role === 'admin';
      const { id } = req.params;
      const lineItem = req.body;

      // Admins can add line items to any quote, regular users only their own
      const quote = await storage.getQuoteById(id, userIsAdmin ? undefined : userId);
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
        width: parseFloat(lineItem.width),
        height: parseFloat(lineItem.height),
        quantity: parseInt(lineItem.quantity),
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
      const userId = req.user.claims.sub;
      const userIsAdmin = req.user.role === 'admin';
      const { id, lineItemId } = req.params;
      const lineItem = req.body;

      // Admins can update line items in any quote, regular users only their own
      const quote = await storage.getQuoteById(id, userIsAdmin ? undefined : userId);
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
      const userId = req.user.claims.sub;
      const userIsAdmin = req.user.role === 'admin';
      const { id, lineItemId } = req.params;

      // Admins can delete line items from any quote, regular users only their own
      const quote = await storage.getQuoteById(id, userIsAdmin ? undefined : userId);
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

  const httpServer = createServer(app);

  return httpServer;
}
