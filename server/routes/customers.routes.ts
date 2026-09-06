/**
 * customers.routes.ts
 *
 * Customer CRUD, detail, CSV import/export, and production folder reference routes
 * extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/customers
 *   POST   /api/customers
 *   PATCH  /api/customers/:id
 *   DELETE /api/customers/:id
 *   GET    /api/customers/:id
 *   GET    /api/customers/csv-template
 *   GET    /api/customers/export
 *   POST   /api/customers/import
 *   GET    /api/customers/:id/production-folder-reference
 *   PATCH  /api/customers/:id/production-folder-reference
 *
 * Placement: server/routes/customers.routes.ts
 * Registered by: server/routes.ts via registerCustomerRoutes
 */

import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import Papa from "papaparse";
import { storage } from "../storage";
import { db } from "../db";
import { auditLogs, customers } from "@shared/schema";
import { getRequestOrganizationId } from "../tenantContext";
import {
  insertCustomerSchema,
  insertCustomerSchemaRefined,
  updateCustomerSchema,
  updateCustomerProductionFolderReferenceSchema,
} from "@shared/schema";
import { customerProductionFolderReferenceRepository } from "../storage/customerProductionFolderReference.repo";
import {
  CustomerIdentityConflictError,
  getCustomerMergePreview,
  mergeCustomers,
  mergeDuplicateCustomers,
} from "../services/customerCanonicalIdentityService";
import {
  CanonicalCustomerContactError,
  canonicalCustomerContactOperations,
} from "../services/customers/canonicalCustomerContactOperations";
import { getCustomerCreditExposure, getCustomerCreditExposures } from "../services/customerCreditExposureService";
import { canManageCustomerCommercialConfiguration as canManageCustomerCommercialConfigurationAccess } from "../services/customerCommercialConfigurationAccess";
import {
  CustomerBulkCommercialConfigurationError,
  updateCustomersCommercialConfiguration,
} from "../services/customerBulkCommercialConfiguration.service";
import { bulkCustomerCommercialConfigurationSchema } from "@shared/customerCommercialConfiguration";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function canManageCustomerCredit(role: unknown): boolean {
  return canManageCustomerCommercialConfigurationAccess(role);
}

// Terms and credit limits are commercial configuration. Keep the list projection
// and the mutation boundary aligned so a lower-privilege client cannot obtain or
// change a value simply by bypassing the Customer List UI.
export const canManageCustomerCommercialConfiguration = canManageCustomerCredit;

function projectCustomerForList(customer: Record<string, unknown>, canViewCommercialConfiguration: boolean) {
  if (canViewCommercialConfiguration) return customer;
  const {
    paymentTerms,
    creditLimit,
    creditLimitConfiguredAt,
    creditLimitConfigured,
    creditLimitCents,
    outstandingAr,
    outstandingArCents,
    pendingBilling,
    pendingBillingCents,
    unbilledOpenOrders,
    unbilledOpenOrdersCents,
    creditExposure,
    creditExposureCents,
    availableCredit,
    availableCreditCents,
    overLimitCents,
    currentBalance,
    ...customerWithoutCommercialConfiguration
  } = customer;
  return customerWithoutCommercialConfiguration;
}

// =============================
// Customer Production Folder Helpers
// =============================

const resolveProductionFolderReferenceDraft = (rawPath: string | null | undefined) => {
  const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";

  if (!trimmed) {
    return {
      pathOrUri: "",
      status: "disabled" as const,
      validationError: null,
    };
  }

  if (/[\u0000-\u001f]/.test(trimmed)) {
    return {
      pathOrUri: trimmed,
      status: "invalid" as const,
      validationError: "Folder reference contains unsupported control characters.",
    };
  }

  const looksValid =
    /^\\\\[^\\]+\\[^\\]+/.test(trimmed) ||
    /^[A-Za-z]:\\/.test(trimmed) ||
    /^\//.test(trimmed) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);

  return {
    pathOrUri: trimmed,
    status: looksValid ? ("configured" as const) : ("invalid" as const),
    validationError: looksValid
      ? null
      : "Enter a valid UNC path, drive path, absolute path, or URI.",
  };
};

const saveCustomerProductionFolderReference = async (args: {
  organizationId: string;
  customerId: string;
  companyName: string;
  pathOrUri: string | null | undefined;
}) => {
  const draft = resolveProductionFolderReferenceDraft(args.pathOrUri);
  return customerProductionFolderReferenceRepository.upsertForCustomer(args.organizationId, args.customerId, {
    label: `${args.companyName} Production Folder`,
    folderType: "production_destination",
    pathOrUri: draft.pathOrUri,
    status: draft.status,
    validationError: draft.validationError,
  });
};

export function registerCustomerRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  app.get("/api/customers", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const filters = {
        search: req.query.search as string | undefined,
        status: req.query.status as string | undefined,
        customerType: (req.query.customerType || req.query.type) as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const canViewCommercialConfiguration = canManageCustomerCommercialConfiguration(req.actorOrgRole ?? req.orgRole);

      // Paginated path: when page/pageSize are explicitly provided the caller expects
      // a paginated envelope { items, total, page, pageSize, totalPages, … }.
      const hasPaginationParams = req.query.page !== undefined || req.query.pageSize !== undefined;
      if (hasPaginationParams) {
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = Math.min(200, parseInt(req.query.pageSize as string) || 50);
        const result = await storage.getCustomersPaged(organizationId, {
          ...filters,
          page,
          pageSize,
          sortBy: req.query.sortBy as string | undefined,
          sortDir: req.query.sortDir as string | undefined,
        });

        const exposures = canViewCommercialConfiguration
          ? await getCustomerCreditExposures(organizationId, result.items)
          : new Map();
        const customersWithCredit = result.items.map((customer: any) => projectCustomerForList({
          ...customer,
          ...(exposures.get(customer.id) ?? {}),
        }, canViewCommercialConfiguration));

        return res.json({
          success: true,
          data: {
            customers: customersWithCredit,
            pagination: {
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              totalPages: result.totalPages,
            },
          },
        });
      }

      // Legacy flat-array path (backward compat for edit-quote, order-detail, customer-form, etc.)
      // Cap at 500 to avoid unbounded queries.
      const customers = await storage.getAllCustomers(organizationId, filters);
      const capped = customers.slice(0, 500);

      const exposures = canViewCommercialConfiguration
        ? await getCustomerCreditExposures(organizationId, capped)
        : new Map();
      const customersWithCredit = capped.map((customer: any) => projectCustomerForList({
        ...customer,
        ...(exposures.get(customer.id) ?? {}),
      }, canViewCommercialConfiguration));

      res.json(customersWithCredit);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.post("/api/customers", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const primaryContactInputSchema = z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        title: z.string().optional(),
        isPrimary: z.boolean().optional(),
      });

      const createCustomerWithContactSchema = insertCustomerSchema.extend({
        primaryContact: primaryContactInputSchema.optional(),
      });

      const requestedCreditLimit = Object.prototype.hasOwnProperty.call(req.body ?? {}, "creditLimit")
        ? req.body.creditLimit
        : undefined;
      const requestedPaymentTerms = Object.prototype.hasOwnProperty.call(req.body ?? {}, "paymentTerms")
        ? req.body.paymentTerms
        : undefined;
      if (requestedCreditLimit !== undefined && !canManageCustomerCredit(req.actorOrgRole ?? req.orgRole)) {
        return res.status(403).json({ message: "Organization Owner or Admin permission is required to set a customer credit limit.", code: "CUSTOMER_CREDIT_LIMIT_FORBIDDEN" });
      }
      if (requestedPaymentTerms !== undefined && !canManageCustomerCommercialConfiguration(req.actorOrgRole ?? req.orgRole)) {
        return res.status(403).json({ message: "Organization Owner or Admin permission is required to change customer payment terms.", code: "CUSTOMER_PAYMENT_TERMS_FORBIDDEN" });
      }
      const createPayload = { ...(req.body ?? {}) };
      delete createPayload.creditLimit;
      const parsed = createCustomerWithContactSchema.parse(createPayload);
      const { primaryContact, ...customerData } = parsed;

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ message: "Authenticated user is required" });
      const result = await canonicalCustomerContactOperations.createCustomer({
        organizationId,
        actorUserId,
        customer: customerData,
        primaryContact: primaryContact || null,
      });

      if (requestedCreditLimit !== undefined) {
        const creditLimit = z.coerce.number().finite().min(0).parse(requestedCreditLimit);
        await db.transaction(async (tx) => {
          const [updated] = await tx.update(customers).set({
            creditLimit: creditLimit.toFixed(2),
            creditLimitConfiguredAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(customers.organizationId, organizationId), eq(customers.id, result.customer.id))).returning();
          if (!updated) return;
          await tx.insert(auditLogs).values({
            organizationId,
            userId: actorUserId,
            actionType: "customer_credit_limit_updated",
            entityType: "customer",
            entityId: updated.id,
            entityName: updated.companyName,
            description: "Set customer credit limit during customer creation.",
            oldValues: { creditLimit: null, creditLimitConfiguredAt: null } as any,
            newValues: { creditLimit: updated.creditLimit, creditLimitConfiguredAt: updated.creditLimitConfiguredAt } as any,
          } as any);
        });
      }

      res.json((await storage.getCustomerById(organizationId, result.customer.id)) ?? result.customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Zod validation error:", error.errors);
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error instanceof CanonicalCustomerContactError) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.post("/api/customers/bulk-commercial-configuration", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ success: false, error: { code: "MISSING_ORGANIZATION_CONTEXT", message: "Missing organization context" } });
      if (!actorUserId) return res.status(401).json({ success: false, error: { code: "ACTOR_REQUIRED", message: "Authenticated user is required" } });
      if (!canManageCustomerCommercialConfiguration(req.actorOrgRole ?? req.orgRole)) {
        return res.status(403).json({ success: false, error: { code: "CUSTOMER_COMMERCIAL_CONFIGURATION_FORBIDDEN", message: "Organization Owner or Admin permission is required to change customer terms or credit limits." } });
      }
      const update = bulkCustomerCommercialConfigurationSchema.parse(req.body ?? {});
      const result = await updateCustomersCommercialConfiguration({ organizationId, actorUserId, update });
      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: fromZodError(error).message } });
      if (error instanceof CustomerBulkCommercialConfigurationError) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      console.error("Error applying bulk customer commercial configuration:", error);
      return res.status(500).json({ success: false, error: { code: "CUSTOMER_BULK_COMMERCIAL_UPDATE_FAILED", message: "Unable to update the selected customers." } });
    }
  });

  app.patch("/api/customers/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const payload = { ...(req.body || {}) };
      const requestedCreditLimit = Object.prototype.hasOwnProperty.call(payload, "creditLimit")
        ? payload.creditLimit
        : undefined;
      const requestedPaymentTerms = Object.prototype.hasOwnProperty.call(payload, "paymentTerms")
        ? payload.paymentTerms
        : undefined;
      if (requestedCreditLimit !== undefined && !canManageCustomerCredit(req.actorOrgRole ?? req.orgRole)) {
        return res.status(403).json({ message: "Organization Owner or Admin permission is required to change a customer credit limit.", code: "CUSTOMER_CREDIT_LIMIT_FORBIDDEN" });
      }
      if (requestedPaymentTerms !== undefined && !canManageCustomerCommercialConfiguration(req.actorOrgRole ?? req.orgRole)) {
        return res.status(403).json({ message: "Organization Owner or Admin permission is required to change customer payment terms.", code: "CUSTOMER_PAYMENT_TERMS_FORBIDDEN" });
      }
      const localCompanyFolderPath =
        payload.localCompanyFolderPath === null || typeof payload.localCompanyFolderPath === "string"
          ? payload.localCompanyFolderPath
          : undefined;

      delete payload.localCompanyFolderPath;
      delete payload.customerProductionFolderReference;
      delete payload.creditLimit;

      const customerData = updateCustomerSchema.parse(payload);
      const currentCustomer = await storage.getCustomerById(organizationId, req.params.id);
      if (!currentCustomer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      if (Object.keys(customerData).length > 0) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ message: "Authenticated user is required" });
        await canonicalCustomerContactOperations.updateCustomer({
          organizationId,
          actorUserId,
          customerId: req.params.id,
          patch: customerData,
        });
      }

      if (localCompanyFolderPath !== undefined) {
        await saveCustomerProductionFolderReference({
          organizationId,
          customerId: req.params.id,
          companyName: currentCustomer.companyName,
          pathOrUri: localCompanyFolderPath,
        });
      }

      if (requestedCreditLimit !== undefined) {
        const actorUserId = getUserId(req.user);
        if (!actorUserId) return res.status(401).json({ message: "Authenticated user is required" });
        const creditLimit = z.coerce.number().finite().min(0).parse(requestedCreditLimit);
        const [updated] = await db.transaction(async (tx) => {
          const [row] = await tx.update(customers).set({
            creditLimit: creditLimit.toFixed(2),
            creditLimitConfiguredAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(customers.organizationId, organizationId), eq(customers.id, req.params.id)))
            .returning();
          if (!row) return [] as any[];
          await tx.insert(auditLogs).values({
            organizationId,
            userId: actorUserId,
            actionType: "customer_credit_limit_updated",
            entityType: "customer",
            entityId: row.id,
            entityName: row.companyName,
            description: "Updated customer credit limit.",
            oldValues: { creditLimit: currentCustomer.creditLimit, creditLimitConfiguredAt: (currentCustomer as any).creditLimitConfiguredAt ?? null } as any,
            newValues: { creditLimit: row.creditLimit, creditLimitConfiguredAt: row.creditLimitConfiguredAt } as any,
          } as any);
          return [row];
        });
        if (!updated) return res.status(404).json({ message: "Customer not found" });
      }

      const hydratedCustomer = await storage.getCustomerById(organizationId, req.params.id);
      res.json(hydratedCustomer ?? currentCustomer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof CanonicalCustomerContactError) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }
      console.error("Error updating customer:", error);
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteCustomer(organizationId, req.params.id);
      res.json({ message: "Customer deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer:", error);
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  const customerMergePreviewSchema = z.object({
    customerIds: z.array(z.string().trim().min(1)).min(2).max(20),
  }).strict();
  const customerMergeSchema = z.object({
    survivorCustomerId: z.string().trim().min(1),
    sourceCustomerIds: z.array(z.string().trim().min(1)).min(1).max(19),
    fieldChoices: z.record(z.string().trim().min(1)).default({}),
    primaryContactId: z.string().trim().min(1).optional().nullable(),
    reviewed: z.literal(true),
    reason: z.string().trim().max(500).optional().nullable(),
  }).strict();

  app.post("/api/customers/merge/preview", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: { code: "MISSING_ORGANIZATION_CONTEXT", message: "Missing organization context" } });
      const input = customerMergePreviewSchema.parse(req.body ?? {});
      return res.json({ success: true, data: await getCustomerMergePreview({ organizationId, customerIds: input.customerIds }) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: fromZodError(error).message } });
      if (error instanceof CustomerIdentityConflictError) return res.status(409).json({ success: false, error: { code: error.code, message: error.message, details: error.details } });
      console.error("Error preparing customer merge:", error);
      return res.status(500).json({ success: false, error: { code: "CUSTOMER_MERGE_PREVIEW_FAILED", message: "Failed to prepare customer merge" } });
    }
  });

  app.post("/api/customers/merge", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ success: false, error: { code: "MISSING_ORGANIZATION_CONTEXT", message: "Missing organization context" } });
      if (!actorUserId) return res.status(401).json({ success: false, error: { code: "ACTOR_REQUIRED", message: "Authenticated user is required" } });
      const input = customerMergeSchema.parse(req.body ?? {});
      const result = await mergeCustomers({ organizationId, actorUserId, ...input });
      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: fromZodError(error).message } });
      if (error instanceof CustomerIdentityConflictError) return res.status(409).json({ success: false, error: { code: error.code, message: error.message, details: error.details } });
      console.error("Error merging customers:", error);
      return res.status(500).json({ success: false, error: { code: "CUSTOMER_MERGE_FAILED", message: "Failed to merge customers" } });
    }
  });

  app.post("/api/customers/:survivorId/merge-duplicate", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    const mergeSchema = z.object({
      duplicateCustomerId: z.string().trim().min(1),
      reviewed: z.boolean().optional().default(false),
      reason: z.string().trim().max(500).optional().nullable(),
    });

    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({
          success: false,
          error: { code: "MISSING_ORGANIZATION_CONTEXT", message: "Missing organization context" },
        });
      }

      const input = mergeSchema.parse(req.body || {});
      const result = await mergeDuplicateCustomers({
        organizationId,
        survivorCustomerId: String(req.params.survivorId),
        duplicateCustomerId: input.duplicateCustomerId,
        reviewed: input.reviewed,
        reason: input.reason,
        actorUserId: req.user?.id ?? null,
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: fromZodError(error).message },
        });
      }
      if (error instanceof CustomerIdentityConflictError) {
        const status = error.code === "CUSTOMER_NOT_FOUND" ? 404 : 409;
        return res.status(status).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
      }
      console.error("Error merging duplicate customers:", error);
      return res.status(500).json({
        success: false,
        error: { code: "CUSTOMER_MERGE_FAILED", message: "Failed to merge duplicate customers" },
      });
    }
  });

  // =============================
  // Customer CSV Import/Export
  // =============================
  app.get("/api/customers/csv-template", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const templateData = [
        {
          'Customer ID': '',
          'Company Name': 'Acme Printing',
          'Customer Type': 'business',
          Email: 'billing@acme.com',
          Phone: '555-555-5555',
          Website: 'https://acme.com',
          'Billing Street 1': '123 Main St',
          'Billing Street 2': '',
          'Billing City': 'Dallas',
          'Billing State': 'TX',
          'Billing Postal Code': '75001',
          'Billing Country': 'US',
          'Shipping Street 1': '123 Main St',
          'Shipping Street 2': '',
          'Shipping City': 'Dallas',
          'Shipping State': 'TX',
          'Shipping Postal Code': '75001',
          'Shipping Country': 'US',
          'Tax ID': '',
          'Credit Limit': '0',
          'Pricing Tier': 'default',
          'Default Discount %': '',
          'Default Markup %': '',
          'Default Margin %': '',
          'Product Visibility Mode': 'default',
          'Is Tax Exempt': 'false',
          'Tax Rate Override': '',
          'Tax Exempt Reason': '',
          'Tax Exempt Certificate Ref': '',
          'Is Active': 'true',
          Status: 'active',
          Notes: '',
          'External Accounting ID': '',
        },
      ];

      const csv = Papa.unparse(templateData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Error generating customer CSV template:', error);
      res.status(500).json({ message: 'Failed to generate CSV template' });
    }
  });

  app.get("/api/customers/export", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const customers = await storage.getAllCustomers(organizationId, {});

      const exportData = customers.map((customer: any) => ({
        'Customer ID': customer.id,
        'Company Name': customer.companyName || '',
        'Customer Type': customer.customerType || '',
        Email: customer.email || '',
        Phone: customer.phone || '',
        Website: customer.website || '',
        'Billing Street 1': customer.billingStreet1 || '',
        'Billing Street 2': customer.billingStreet2 || '',
        'Billing City': customer.billingCity || '',
        'Billing State': customer.billingState || '',
        'Billing Postal Code': customer.billingPostalCode || '',
        'Billing Country': customer.billingCountry || '',
        'Shipping Street 1': customer.shippingStreet1 || '',
        'Shipping Street 2': customer.shippingStreet2 || '',
        'Shipping City': customer.shippingCity || '',
        'Shipping State': customer.shippingState || '',
        'Shipping Postal Code': customer.shippingPostalCode || '',
        'Shipping Country': customer.shippingCountry || '',
        'Tax ID': customer.taxId || '',
        'Credit Limit': customer.creditLimit ?? '',
        'Pricing Tier': customer.pricingTier || 'default',
        'Default Discount %': customer.defaultDiscountPercent ?? '',
        'Default Markup %': customer.defaultMarkupPercent ?? '',
        'Default Margin %': customer.defaultMarginPercent ?? '',
        'Product Visibility Mode': customer.productVisibilityMode || 'default',
        'Is Tax Exempt': customer.isTaxExempt ? 'true' : 'false',
        'Tax Rate Override': customer.taxRateOverride ?? '',
        'Tax Exempt Reason': customer.taxExemptReason || '',
        'Tax Exempt Certificate Ref': customer.taxExemptCertificateRef || '',
        'Is Active': customer.isActive === false ? 'false' : 'true',
        Status: customer.status || '',
        Notes: customer.notes || '',
        'External Accounting ID': customer.externalAccountingId || '',
      }));

      const csv = Papa.unparse(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting customers:', error);
      res.status(500).json({ message: 'Failed to export customers' });
    }
  });

  app.get("/api/customers/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const customer = await storage.getCustomerById(organizationId, req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      const exposure = await getCustomerCreditExposure(organizationId, customer);
      res.json({ ...customer, ...exposure });
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.get("/api/customers/:id/production-folder-reference", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const customer = await storage.getCustomerById(organizationId, req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const reference = await customerProductionFolderReferenceRepository.getForCustomer(organizationId, req.params.id);
      return res.json({
        success: true,
        data:
          reference ?? {
            customerId: req.params.id,
            folderType: "production_destination",
            pathOrUri: null,
            status: "missing",
            validationError: null,
          },
      });
    } catch (error) {
      console.error("Error fetching customer production folder reference:", error);
      return res.status(500).json({ error: "Failed to fetch customer production folder reference" });
    }
  });

  app.patch("/api/customers/:id/production-folder-reference", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const customer = await storage.getCustomerById(organizationId, req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const input = updateCustomerProductionFolderReferenceSchema
        .extend({
          pathOrUri: z.string().max(2048).nullable().optional(),
          disable: z.boolean().optional(),
        })
        .parse(req.body || {});

      const nextPath = input.disable ? "" : input.pathOrUri;
      const saved = await saveCustomerProductionFolderReference({
        organizationId,
        customerId: req.params.id,
        companyName: customer.companyName,
        pathOrUri: nextPath,
      });

      return res.json({ success: true, data: saved });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      console.error("Error updating customer production folder reference:", error);
      return res.status(500).json({ error: "Failed to update customer production folder reference" });
    }
  });

  app.post("/api/customers/import", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const { csvData, dryRun } = req.body as { csvData?: unknown; dryRun?: unknown };
      if (!csvData || typeof csvData !== 'string') {
        return res.status(400).json({ message: 'CSV data is required' });
      }

      const parseResult = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
      });

      if (parseResult.errors.length > 0) {
        console.error('Customer CSV parsing errors:', parseResult.errors);
        return res.status(400).json({
          message: 'CSV parsing failed',
          errors: parseResult.errors.map((e) => e.message),
        });
      }

      const rows = parseResult.data as Record<string, string>[];
      if (rows.length === 0) {
        return res.status(400).json({ message: 'CSV must contain at least one data row' });
      }

      const parseBool = (v: unknown) => {
        if (v == null) return undefined;
        const s = String(v).trim().toLowerCase();
        if (s === '') return undefined;
        if (['true', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', '0', 'no', 'n'].includes(s)) return false;
        return undefined;
      };

      const parseNum = (v: unknown) => {
        if (v == null) return undefined;
        const s = String(v).trim();
        if (s === '') return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      };

      const parseTaxRateOverride = (v: unknown) => {
        const n = parseNum(v);
        if (n == null) return undefined;
        // Allow 8.25 to mean 8.25%.
        if (n > 1) return n / 100;
        return n;
      };

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const rowErrors: Array<{ row: number; message: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const customerId = (row['Customer ID'] || row['ID'] || '').trim();
        const companyName = (row['Company Name'] || '').trim();
        if (!companyName) {
          skipped++;
          continue;
        }

        const payload: any = {
          companyName,
          customerType: (row['Customer Type'] || '').trim() || undefined,
          email: (row['Email'] || row['email'] || '').trim() || undefined,
          phone: (row['Phone'] || '').trim() || undefined,
          website: (row['Website'] || '').trim() || undefined,

          billingStreet1: (row['Billing Street 1'] || '').trim() || undefined,
          billingStreet2: (row['Billing Street 2'] || '').trim() || undefined,
          billingCity: (row['Billing City'] || '').trim() || undefined,
          billingState: (row['Billing State'] || '').trim() || undefined,
          billingPostalCode: (row['Billing Postal Code'] || '').trim() || undefined,
          billingCountry: (row['Billing Country'] || '').trim() || undefined,

          shippingStreet1: (row['Shipping Street 1'] || '').trim() || undefined,
          shippingStreet2: (row['Shipping Street 2'] || '').trim() || undefined,
          shippingCity: (row['Shipping City'] || '').trim() || undefined,
          shippingState: (row['Shipping State'] || '').trim() || undefined,
          shippingPostalCode: (row['Shipping Postal Code'] || '').trim() || undefined,
          shippingCountry: (row['Shipping Country'] || '').trim() || undefined,

          taxId: (row['Tax ID'] || '').trim() || undefined,
          creditLimit: parseNum(row['Credit Limit']),
          pricingTier: (row['Pricing Tier'] || '').trim() || undefined,
          defaultDiscountPercent: parseNum(row['Default Discount %']),
          defaultMarkupPercent: parseNum(row['Default Markup %']),
          defaultMarginPercent: parseNum(row['Default Margin %']),
          productVisibilityMode: (row['Product Visibility Mode'] || '').trim() || undefined,

          isTaxExempt: parseBool(row['Is Tax Exempt']),
          taxRateOverride: parseTaxRateOverride(row['Tax Rate Override']),
          taxExemptReason: (row['Tax Exempt Reason'] || '').trim() || undefined,
          taxExemptCertificateRef: (row['Tax Exempt Certificate Ref'] || '').trim() || undefined,

          isActive: parseBool(row['Is Active']),
          status: (row['Status'] || '').trim() || undefined,
          notes: (row['Notes'] || '').trim() || undefined,

          externalAccountingId: (row['External Accounting ID'] || '').trim() || undefined,
        };

        try {
          if (customerId) {
            // Update
            const parsedUpdate = updateCustomerSchema.parse(payload);
            if (parsedUpdate.isTaxExempt && !parsedUpdate.taxExemptReason) {
              throw new Error('Tax exempt reason is required when marking customer as tax exempt');
            }
            if (!dryRun) {
              await storage.updateCustomer(organizationId, customerId, parsedUpdate);
            }
            updated++;
          } else {
            // Create
            const parsedCreate = insertCustomerSchemaRefined.parse(payload);
            if (!dryRun) {
              await storage.createCustomerWithPrimaryContact(organizationId, {
                customer: parsedCreate,
                primaryContact: null,
              });
            }
            created++;
          }
        } catch (err: any) {
          const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Unknown error');
          rowErrors.push({ row: i + 2, message }); // +2 because header row is 1
        }
      }

      res.json({
        message: dryRun ? 'Customer import validated' : 'Customers imported successfully',
        imported: { created, updated, skipped },
        errors: rowErrors,
      });
    } catch (error) {
      console.error('Error importing customers:', error);
      res.status(500).json({ message: 'Failed to import customers' });
    }
  });
}
