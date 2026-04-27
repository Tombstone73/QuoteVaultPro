/**
 * pricing.routes.ts
 *
 * Pricing Formulas, Pricing Rules, and Formula Templates routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/pricing-formulas
 *   GET    /api/pricing-formulas/:id
 *   GET    /api/pricing-formulas/:id/products
 *   POST   /api/pricing-formulas
 *   PATCH  /api/pricing-formulas/:id
 *   DELETE /api/pricing-formulas/:id
 *
 *   GET    /api/pricing-rules
 *
 *   GET    /api/formula-templates
 *   GET    /api/formula-templates/:id
 *   GET    /api/formula-templates/:id/products
 *   POST   /api/formula-templates
 *   PATCH  /api/formula-templates/:id
 *   DELETE /api/formula-templates/:id
 *
 * Placement: server/routes/pricing.routes.ts
 * Registered by: server/routes.ts via registerPricingRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { insertPricingFormulaSchema, updatePricingFormulaSchema } from "@shared/schema";

export function registerPricingRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  // ==================== Pricing Formulas Routes ====================

  app.get("/api/pricing-formulas", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formulas = await storage.getPricingFormulas(organizationId);
      res.json(formulas);
    } catch (error) {
      console.error("Error fetching pricing formulas:", error);
      res.status(500).json({ message: "Failed to fetch pricing formulas" });
    }
  });

  app.get("/api/pricing-formulas/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formula = await storage.getPricingFormulaById(organizationId, req.params.id);
      if (!formula) {
        return res.status(404).json({ message: "Pricing formula not found" });
      }
      res.json(formula);
    } catch (error) {
      console.error("Error fetching pricing formula:", error);
      res.status(500).json({ message: "Failed to fetch pricing formula" });
    }
  });

  app.get("/api/pricing-formulas/:id/products", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const result = await storage.getPricingFormulaWithProducts(organizationId, req.params.id);
      if (!result) {
        return res.status(404).json({ message: "Pricing formula not found" });
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching pricing formula with products:", error);
      res.status(500).json({ message: "Failed to fetch pricing formula with products" });
    }
  });

  app.post("/api/pricing-formulas", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formulaData = insertPricingFormulaSchema.parse(req.body);
      const formula = await storage.createPricingFormula(organizationId, formulaData);
      res.json(formula);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating pricing formula:", error);
      res.status(500).json({ message: "Failed to create pricing formula" });
    }
  });

  app.patch("/api/pricing-formulas/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formulaData = updatePricingFormulaSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const formula = await storage.updatePricingFormula(organizationId, req.params.id, formulaData);
      if (!formula) {
        return res.status(404).json({ message: "Pricing formula not found" });
      }
      res.json(formula);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating pricing formula:", error);
      res.status(500).json({ message: "Failed to update pricing formula" });
    }
  });

  app.delete("/api/pricing-formulas/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deletePricingFormula(organizationId, req.params.id);
      res.json({ message: "Pricing formula deleted successfully" });
    } catch (error) {
      console.error("Error deleting pricing formula:", error);
      res.status(500).json({ message: "Failed to delete pricing formula" });
    }
  });

  // ==================== Pricing Rules Routes ====================

  app.get("/api/pricing-rules", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const rules = await storage.getAllPricingRules(organizationId);
      res.json(rules);
    } catch (error) {
      console.error("Error fetching pricing rules:", error);
      res.status(500).json({ message: "Failed to fetch pricing rules" });
    }
  });

  // ==================== Formula Templates Routes (admin only) ====================

  app.get("/api/formula-templates", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const templates = await storage.getAllFormulaTemplates(organizationId);
      console.log(`[DEBUG] Returning ${templates.length} formula templates:`, templates.map(t => ({ id: t.id, name: t.name })));
      res.json(templates);
    } catch (error) {
      console.error("Error fetching formula templates:", error);
      res.status(500).json({ message: "Failed to fetch formula templates" });
    }
  });

  app.get("/api/formula-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const template = await storage.getFormulaTemplateById(organizationId, id);
      if (!template) {
        return res.status(404).json({ message: "Formula template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error fetching formula template:", error);
      res.status(500).json({ message: "Failed to fetch formula template" });
    }
  });

  app.get("/api/formula-templates/:id/products", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const products = await storage.getProductsByFormulaTemplate(organizationId, id);
      res.json(products);
    } catch (error) {
      console.error("Error fetching products for formula template:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/formula-templates", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      console.log("[DEBUG] Creating formula template with data:", req.body);
      const template = await storage.createFormulaTemplate(organizationId, req.body);
      console.log("[DEBUG] Created formula template:", { id: template.id, name: template.name });
      res.json(template);
    } catch (error) {
      console.error("Error creating formula template:", error);
      res.status(500).json({ message: "Failed to create formula template" });
    }
  });

  app.patch("/api/formula-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const template = await storage.updateFormulaTemplate(organizationId, id, req.body);
      res.json(template);
    } catch (error) {
      console.error("Error updating formula template:", error);
      res.status(500).json({ message: "Failed to update formula template" });
    }
  });

  app.delete("/api/formula-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      await storage.deleteFormulaTemplate(organizationId, id);
      res.json({ message: "Formula template deleted successfully" });
    } catch (error) {
      console.error("Error deleting formula template:", error);
      res.status(500).json({ message: "Failed to delete formula template" });
    }
  });
}
