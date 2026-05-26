/**
 * catalogSettings.routes.ts
 *
 * Product Types and Global Variables routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/product-types
 *   POST   /api/product-types
 *   PATCH  /api/product-types/:id
 *   DELETE /api/product-types/:id
 *
 *   GET    /api/global-variables
 *   POST   /api/global-variables
 *   PATCH  /api/global-variables/:id
 *   DELETE /api/global-variables/:id
 *
 * Placement: server/routes/catalogSettings.routes.ts
 * Registered by: server/routes.ts via registerCatalogSettingsRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { insertGlobalVariableSchema, updateGlobalVariableSchema } from "@shared/schema";
import { getMaxInvoiceNumber } from "../invoicesService";
import { DOCUMENT_NUMBER_PREFIX_VARIABLES, sanitizeDocumentNumberPrefix } from "@shared/documentNumbering";

const DOCUMENT_NUMBER_PREFIX_NAMES = new Set(Object.values(DOCUMENT_NUMBER_PREFIX_VARIABLES));

export function registerCatalogSettingsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
    requireOrgOwnerAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin, requireOrgOwnerAdmin } = middleware;

  // ==================== Product Types Routes ====================

  app.get("/api/product-types", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const types = await storage.getAllProductTypes(organizationId);
      res.json(types);
    } catch (error) {
      console.error("Error fetching product types:", error);
      res.status(500).json({ message: "Failed to fetch product types" });
    }
  });

  app.post("/api/product-types", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const newType = await storage.createProductType(organizationId, req.body);
      res.json(newType);
    } catch (error) {
      console.error("Error creating product type:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create product type" });
    }
  });

  app.patch("/api/product-types/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const updated = await storage.updateProductType(organizationId, id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating product type:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to update product type" });
    }
  });

  app.delete("/api/product-types/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      await storage.deleteProductType(organizationId, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting product type:", error);
      if (error.code === '23503') {
        return res.status(400).json({ message: "Cannot delete product type that is in use by products" });
      }
      res.status(500).json({ message: "Failed to delete product type" });
    }
  });

  // ==================== Global Variables Routes ====================

  app.get("/api/global-variables", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const variables = await storage.getAllGlobalVariables(organizationId);
      res.json(variables);
    } catch (error) {
      console.error("Error fetching global variables:", error);
      res.status(500).json({ message: "Failed to fetch global variables" });
    }
  });

  app.post("/api/global-variables", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const variableData = insertGlobalVariableSchema.parse(req.body);
      if (DOCUMENT_NUMBER_PREFIX_NAMES.has(variableData.name)) {
        try {
          variableData.value = sanitizeDocumentNumberPrefix(variableData.value);
          variableData.category = variableData.category || "numbering";
        } catch (prefixError: any) {
          return res.status(400).json({ message: prefixError?.message || "Invalid document number prefix" });
        }
      }
      const variable = await storage.createGlobalVariable(organizationId, variableData);
      res.json(variable);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating global variable:", error);
      res.status(500).json({ message: "Failed to create global variable" });
    }
  });

  app.patch("/api/global-variables/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const variableData = updateGlobalVariableSchema.parse({
        ...req.body,
        id: req.params.id,
      });

      // Validate numbering sequence updates — prevent setting below the existing maximum
      const currentVariable = await storage.getGlobalVariableById(organizationId, req.params.id);
      if (variableData.value !== undefined && currentVariable?.name) {
        if (DOCUMENT_NUMBER_PREFIX_NAMES.has(currentVariable.name)) {
          try {
            variableData.value = sanitizeDocumentNumberPrefix(variableData.value);
          } catch (prefixError: any) {
            return res.status(400).json({ message: prefixError?.message || "Invalid document number prefix" });
          }
        } else if (currentVariable.name === 'next_quote_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxQuoteNumber = await storage.getMaxQuoteNumber(organizationId);
          if (maxQuoteNumber !== null && newValue <= maxQuoteNumber) {
            return res.status(400).json({
              message: `Cannot set next quote number to ${newValue}. The highest existing quote number is ${maxQuoteNumber}. Please set a value greater than ${maxQuoteNumber}.`
            });
          }
        } else if (currentVariable.name === 'next_order_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxOrderNumber = await storage.getMaxOrderNumber(organizationId);
          if (maxOrderNumber !== null && newValue <= maxOrderNumber) {
            return res.status(400).json({
              message: `Cannot set next order number to ${newValue}. The highest existing order number is ${maxOrderNumber}. Please set a value greater than ${maxOrderNumber}.`
            });
          }
        } else if (currentVariable.name === 'next_invoice_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxInvoiceNumber = await getMaxInvoiceNumber(organizationId);
          if (maxInvoiceNumber !== null && newValue <= maxInvoiceNumber) {
            return res.status(400).json({
              message: `Cannot set next invoice number to ${newValue}. The highest existing invoice number is ${maxInvoiceNumber}. Please set a value greater than ${maxInvoiceNumber}.`
            });
          }
        }
      }

      const variable = await storage.updateGlobalVariable(organizationId, req.params.id, variableData);
      res.json(variable);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating global variable:", error);
      res.status(500).json({ message: "Failed to update global variable" });
    }
  });

  app.delete("/api/global-variables/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteGlobalVariable(organizationId, req.params.id);
      res.json({ message: "Global variable deleted successfully" });
    } catch (error) {
      console.error("Error deleting global variable:", error);
      res.status(500).json({ message: "Failed to delete global variable" });
    }
  });
}
