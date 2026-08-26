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
const DOCUMENT_NUMBER_SEQUENCE_NAMES = new Set([
  "next_quote_number",
  "next_order_number",
  "next_invoice_number",
  "next_purchase_order_number",
  "next_job_number",
]);

type JsonErrorResponse = {
  success: false;
  code: string;
  message: string;
  field?: string;
};

export class GlobalVariableValidationError extends Error {
  status = 400;
  code: string;
  field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = "GlobalVariableValidationError";
    this.code = code;
    this.field = field;
  }
}

function sendGlobalVariableError(res: any, error: unknown, fallback = "Global variable request failed.") {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      code: "GLOBAL_VARIABLE_VALIDATION_ERROR",
      message: fromZodError(error).message,
    } satisfies JsonErrorResponse);
  }
  const status = (error as any)?.status ?? (error as any)?.statusCode ?? 500;
  const payload: JsonErrorResponse = {
    success: false,
    code: (error as any)?.code ?? (status >= 500 ? "GLOBAL_VARIABLE_UPDATE_FAILED" : "GLOBAL_VARIABLE_VALIDATION_ERROR"),
    message: (error as any)?.message ?? fallback,
  };
  if ((error as any)?.field) payload.field = (error as any).field;
  if (status >= 500) console.error("Global variable route error:", error);
  return res.status(status).json(payload);
}

export function normalizeStartingNumberValue(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GlobalVariableValidationError("INVALID_STARTING_NUMBER", "Starting number must be a finite positive whole number.", "value");
    }
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new GlobalVariableValidationError("INVALID_STARTING_NUMBER", "Starting number must be a positive whole number.", "value");
    }
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new GlobalVariableValidationError("INVALID_STARTING_NUMBER", "Starting number is required.", "value");
    }
    if (!/^\d+$/.test(trimmed)) {
      throw new GlobalVariableValidationError("INVALID_STARTING_NUMBER", "Starting number must contain only digits.", "value");
    }
    const numericValue = Number(trimmed);
    if (!Number.isSafeInteger(numericValue) || numericValue < 1) {
      throw new GlobalVariableValidationError("INVALID_STARTING_NUMBER", "Starting number must be a positive whole number.", "value");
    }
    return trimmed;
  }
  throw new GlobalVariableValidationError("INVALID_STARTING_NUMBER", "Starting number must be sent as a string or finite number.", "value");
}

export function normalizeGlobalVariableValueForRequest(name: string, value: unknown): string {
  if (DOCUMENT_NUMBER_SEQUENCE_NAMES.has(name)) return normalizeStartingNumberValue(value);
  if (DOCUMENT_NUMBER_PREFIX_NAMES.has(name)) return sanitizeDocumentNumberPrefix(value);
  if (typeof value !== "string") {
    throw new GlobalVariableValidationError("INVALID_GLOBAL_VARIABLE_VALUE", "Global variable value must be a string.", "value");
  }
  return value;
}

export async function assertStartingNumberDoesNotMoveBackward(input: {
  organizationId: string;
  variableName: string;
  value: string;
  getMaxQuoteNumber: (organizationId: string) => Promise<number | null>;
  getMaxOrderNumber: (organizationId: string) => Promise<number | null>;
  getMaxInvoiceNumber: (organizationId: string) => Promise<number | null>;
  getMaxPurchaseOrderNumber: (organizationId: string) => Promise<number | null>;
}) {
  if (!DOCUMENT_NUMBER_SEQUENCE_NAMES.has(input.variableName)) return;
  const newValue = Number(input.value);
  const type = input.variableName === "next_quote_number"
    ? "quote"
    : input.variableName === "next_order_number"
      ? "order"
      : input.variableName === "next_invoice_number"
        ? "invoice"
        : "purchase order";
  const maxNumber = input.variableName === "next_quote_number"
    ? await input.getMaxQuoteNumber(input.organizationId)
    : input.variableName === "next_order_number"
      ? await input.getMaxOrderNumber(input.organizationId)
      : input.variableName === "next_invoice_number"
        ? await input.getMaxInvoiceNumber(input.organizationId)
        : await input.getMaxPurchaseOrderNumber(input.organizationId);
  if (maxNumber !== null && newValue <= maxNumber) {
    throw new GlobalVariableValidationError(
      "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
      `Cannot set next ${type} number to ${input.value}. The highest existing ${type} number is ${maxNumber}. Please set a value greater than ${maxNumber}.`,
      "value",
    );
  }
}

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
      const rawName = typeof req.body?.name === "string" ? req.body.name : "";
      if (rawName === "next_job_number") {
        return res.status(403).json({ success: false, code: "SHARED_JOB_NUMBER_SEQUENCE_MANAGED", message: "The shared Job Number sequence is created and advanced only by the system allocator." });
      }
      const normalizedValue = normalizeGlobalVariableValueForRequest(rawName, req.body?.value);
      const variableData = insertGlobalVariableSchema.parse({
        ...req.body,
        value: normalizedValue,
      });
      if (DOCUMENT_NUMBER_PREFIX_NAMES.has(variableData.name) || DOCUMENT_NUMBER_SEQUENCE_NAMES.has(variableData.name)) {
        variableData.category = variableData.category || "numbering";
      }
      await assertStartingNumberDoesNotMoveBackward({
        organizationId,
        variableName: variableData.name,
        value: variableData.value,
        getMaxQuoteNumber: storage.getMaxQuoteNumber,
        getMaxOrderNumber: storage.getMaxOrderNumber,
        getMaxInvoiceNumber,
        getMaxPurchaseOrderNumber: storage.getMaxPurchaseOrderNumber,
      });
      const variable = await storage.createGlobalVariable(organizationId, variableData);
      res.json(variable);
    } catch (error) {
      return sendGlobalVariableError(res, error, "Failed to create global variable");
    }
  });

  app.patch("/api/global-variables/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const idParse = z.string().min(1).safeParse(req.params.id);
      if (!idParse.success) {
        return res.status(400).json({ success: false, code: "INVALID_GLOBAL_VARIABLE_ID", message: "Invalid global variable ID." });
      }

      const currentVariable = await storage.getGlobalVariableById(organizationId, req.params.id);
      if (!currentVariable) {
        return res.status(404).json({ success: false, code: "GLOBAL_VARIABLE_NOT_FOUND", message: "Global variable not found." });
      }
      if (currentVariable.name === "next_job_number" && req.body && Object.prototype.hasOwnProperty.call(req.body, "value")) {
        return res.status(403).json({
          success: false,
          code: "SHARED_JOB_NUMBER_SEQUENCE_MANAGED",
          message: "The shared Job Number sequence is allocated atomically and cannot be edited manually.",
        });
      }

      const normalizedValue = req.body && Object.prototype.hasOwnProperty.call(req.body, "value")
        ? normalizeGlobalVariableValueForRequest(currentVariable.name, req.body.value)
        : undefined;
      const variableData = updateGlobalVariableSchema.parse({
        ...req.body,
        id: req.params.id,
        ...(normalizedValue !== undefined ? { value: normalizedValue } : {}),
      });

      // Validate numbering sequence updates — prevent setting below the existing maximum
      if (variableData.value !== undefined && currentVariable?.name) {
        if (DOCUMENT_NUMBER_PREFIX_NAMES.has(currentVariable.name)) {
          try {
            variableData.value = sanitizeDocumentNumberPrefix(variableData.value);
          } catch (prefixError: any) {
            return res.status(400).json({
              success: false,
              code: "INVALID_DOCUMENT_NUMBER_PREFIX",
              field: "value",
              message: prefixError?.message || "Invalid document number prefix",
            });
          }
        } else if (currentVariable.name === 'next_quote_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxQuoteNumber = await storage.getMaxQuoteNumber(organizationId);
          if (maxQuoteNumber !== null && newValue <= maxQuoteNumber) {
            return res.status(400).json({
              success: false,
              code: "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
              field: "value",
              message: `Cannot set next quote number to ${newValue}. The highest existing quote number is ${maxQuoteNumber}. Please set a value greater than ${maxQuoteNumber}.`
            });
          }
        } else if (currentVariable.name === 'next_order_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxOrderNumber = await storage.getMaxOrderNumber(organizationId);
          if (maxOrderNumber !== null && newValue <= maxOrderNumber) {
            return res.status(400).json({
              success: false,
              code: "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
              field: "value",
              message: `Cannot set next order number to ${newValue}. The highest existing order number is ${maxOrderNumber}. Please set a value greater than ${maxOrderNumber}.`
            });
          }
        } else if (currentVariable.name === 'next_invoice_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxInvoiceNumber = await getMaxInvoiceNumber(organizationId);
          if (maxInvoiceNumber !== null && newValue <= maxInvoiceNumber) {
            return res.status(400).json({
              success: false,
              code: "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
              field: "value",
              message: `Cannot set next invoice number to ${newValue}. The highest existing invoice number is ${maxInvoiceNumber}. Please set a value greater than ${maxInvoiceNumber}.`
            });
          }
        } else if (currentVariable.name === 'next_purchase_order_number') {
          const newValue = Math.floor(Number(variableData.value));
          const maxPurchaseOrderNumber = await storage.getMaxPurchaseOrderNumber(organizationId);
          if (maxPurchaseOrderNumber !== null && newValue <= maxPurchaseOrderNumber) {
            return res.status(400).json({
              success: false,
              code: "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
              field: "value",
              message: `Cannot set next purchase order number to ${newValue}. The highest existing purchase order number is ${maxPurchaseOrderNumber}. Please set a value greater than ${maxPurchaseOrderNumber}.`
            });
          }
        }
      }

      const variable = await storage.updateGlobalVariable(organizationId, req.params.id, variableData);
      res.json(variable);
    } catch (error) {
      return sendGlobalVariableError(res, error, "Failed to update global variable");
    }
  });

  app.delete("/api/global-variables/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const currentVariable = await storage.getGlobalVariableById(organizationId, req.params.id);
      if (currentVariable?.name === "next_job_number") {
        return res.status(403).json({ success: false, code: "SHARED_JOB_NUMBER_SEQUENCE_MANAGED", message: "The shared Job Number sequence cannot be deleted." });
      }
      await storage.deleteGlobalVariable(organizationId, req.params.id);
      res.json({ message: "Global variable deleted successfully" });
    } catch (error) {
      console.error("Error deleting global variable:", error);
      res.status(500).json({ message: "Failed to delete global variable" });
    }
  });
}
