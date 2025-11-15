import type { Express } from "express";
import { createServer, type Server } from "http";
import { evaluate } from "mathjs";
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

  app.get("/api/products", isAuthenticated, async (req, res) => {
    try {
      const products = await storage.getAllProducts();
      res.json(products);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
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

  app.delete("/api/products/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteProduct(req.params.id);
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Failed to delete product" });
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
      const { id } = req.params;

      const quote = await storage.getQuoteById(id, userId);
      
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
      const { id } = req.params;
      const { customerName, subtotal, taxRate, marginPercentage, discountAmount, totalPrice } = req.body;

      // Verify the quote belongs to the user
      const existing = await storage.getQuoteById(id, userId);
      if (!existing) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const updatedQuote = await storage.updateQuote(id, {
        customerName,
        subtotal,
        taxRate,
        marginPercentage,
        discountAmount,
        totalPrice,
      });

      res.json(updatedQuote);
    } catch (error) {
      console.error("Error updating quote:", error);
      res.status(500).json({ message: "Failed to update quote" });
    }
  });

  app.delete("/api/quotes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      // Verify the quote belongs to the user
      const existing = await storage.getQuoteById(id, userId);
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
      const { id } = req.params;
      const lineItem = req.body;

      // Verify the quote belongs to the user
      const quote = await storage.getQuoteById(id, userId);
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
      const { id, lineItemId } = req.params;
      const lineItem = req.body;

      // Verify the quote belongs to the user
      const quote = await storage.getQuoteById(id, userId);
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
      const { id, lineItemId } = req.params;

      // Verify the quote belongs to the user
      const quote = await storage.getQuoteById(id, userId);
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
