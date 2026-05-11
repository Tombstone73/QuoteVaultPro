/**
 * importJobs.routes.ts
 *
 * Enterprise Import Jobs (Validate → Apply) routes extracted from server/routes.ts.
 *
 * Routes:
 *   POST /api/import/jobs/validate
 *   GET  /api/import/jobs/:id
 *   POST /api/import/jobs/:id/apply
 *
 * Placement: server/routes/importJobs.routes.ts
 * Registered by: server/routes.ts via registerImportJobRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import {
  insertCustomerSchemaRefined,
  updateCustomerSchema,
  insertMaterialSchema,
  updateMaterialSchema,
} from "@shared/schema";
import {
  type ImportApplyMode,
  parseCsvOrThrow,
  parseBool,
  parseNum,
  parseTaxRateOverride,
  pickOverrideFiltered,
  buildOverridePatch,
} from "../utils/csvImportUtils";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerImportJobRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  // =============================
  // Enterprise Import Jobs (Validate → Apply)
  // =============================
  app.post('/api/import/jobs/validate', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const schema = z.object({
        resource: z.enum(['customers', 'materials', 'products']),
        csvData: z.string().min(1),
        applyMode: z.enum(['MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES']).optional(),
        sourceFilename: z.string().optional(),
      });

      const parsed = schema.parse(req.body);
      const rows = parseCsvOrThrow(parsed.csvData);
      const userId = getUserId(req.user);

      const applyMode: ImportApplyMode = parsed.applyMode ?? 'MERGE_RESPECT_OVERRIDES';
      const job = await storage.createImportJob({
        organizationId,
        resource: parsed.resource,
        applyMode,
        createdByUserId: userId ?? null,
        sourceFilename: parsed.sourceFilename ?? null,
        summaryJson: null,
      });

      let validCount = 0;
      let invalidCount = 0;
      let skippedCount = 0;

      const jobRows: Array<{ rowNumber: number; status: any; rawJson: any; normalizedJson?: any; error?: string | null }> = [];

      if (parsed.resource === 'customers') {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNumber = i + 2;

          const companyName = (row['Company Name'] || '').trim();
          if (!companyName) {
            skippedCount++;
            jobRows.push({ rowNumber, status: 'skipped', rawJson: row, error: 'Missing Company Name' });
            continue;
          }

          const normalized: any = {
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

          // Identifiers used on apply
          const identifiers = {
            customerId: (row['Customer ID'] || row['ID'] || '').trim() || undefined,
          };

          try {
            // Use refined schema to validate create-like payload (strongest validation).
            insertCustomerSchemaRefined.parse(normalized);
            validCount++;
            jobRows.push({ rowNumber, status: 'valid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: null });
          } catch (err: any) {
            invalidCount++;
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Invalid row');
            jobRows.push({ rowNumber, status: 'invalid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: message });
          }
        }
      } else if (parsed.resource === 'materials') {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNumber = i + 2;
          const name = (row['Name'] || '').trim();
          const sku = (row['SKU'] || '').trim();
          const type = (row['Type'] || '').trim();
          const unitOfMeasure = (row['Unit Of Measure'] || '').trim();

          if (!name || !sku || !type || !unitOfMeasure) {
            skippedCount++;
            jobRows.push({ rowNumber, status: 'skipped', rawJson: row, error: 'Missing required fields (Name, SKU, Type, Unit Of Measure)' });
            continue;
          }

          const normalized: any = {
            name,
            sku,
            type,
            category: (row['Category'] || '').trim() || undefined,
            unitOfMeasure,
            inventoryUnit: (row['Inventory Unit'] || '').trim() || unitOfMeasure,
            sellPriceUnit: (row['Sell Price Unit'] || '').trim() || unitOfMeasure,
            wholesalePriceUnit: (row['Wholesale Price Unit'] || '').trim() || (row['Sell Price Unit'] || '').trim() || unitOfMeasure,
            vendorCostUnit: (row['Vendor Cost Unit'] || '').trim() || unitOfMeasure,
            consumptionUnit: (row['Consumption Unit'] || '').trim() || (row['Sell Price Unit'] || '').trim() || unitOfMeasure,
            width: parseNum(row['Width']),
            height: parseNum(row['Height']),
            thickness: parseNum(row['Thickness']),
            thicknessUnit: (row['Thickness Unit'] || '').trim() || undefined,
            color: (row['Color'] || '').trim() || undefined,
            costPerUnit: parseNum(row['Cost Per Unit']),
            wholesaleBaseRate: parseNum(row['Wholesale Base Rate']),
            wholesaleMinCharge: parseNum(row['Wholesale Min Charge']),
            retailBaseRate: parseNum(row['Retail Base Rate']),
            retailMinCharge: parseNum(row['Retail Min Charge']),
            stockQuantity: parseNum(row['Stock Quantity']),
            minStockAlert: parseNum(row['Min Stock Alert']),
            isActive: parseBool(row['Is Active']),
            preferredVendorId: (row['Preferred Vendor ID'] || '').trim() || undefined,
            vendorSku: (row['Vendor SKU'] || '').trim() || undefined,
            vendorCostPerUnit: parseNum(row['Vendor Cost Per Unit']),
            rollLengthFt: parseNum(row['Roll Length Ft']),
            costPerRoll: parseNum(row['Cost Per Roll']),
            edgeWasteInPerSide: parseNum(row['Edge Waste In Per Side']),
            leadWasteFt: parseNum(row['Lead Waste Ft']),
            tailWasteFt: parseNum(row['Tail Waste Ft']),
          };

          const identifiers = {
            materialId: (row['Material ID'] || row['ID'] || '').trim() || undefined,
          };

          try {
            insertMaterialSchema.parse(normalized);
            validCount++;
            jobRows.push({ rowNumber, status: 'valid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: null });
          } catch (err: any) {
            invalidCount++;
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Invalid row');
            jobRows.push({ rowNumber, status: 'invalid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: message });
          }
        }
      } else {
        // Products: use existing endpoints for now; create a job with a clear message.
        invalidCount = rows.length;
        for (let i = 0; i < rows.length; i++) {
          jobRows.push({ rowNumber: i + 2, status: 'invalid', rawJson: rows[i], error: 'Products import via Import Jobs not implemented yet. Use /api/products/import.' });
        }
      }

      await storage.addImportJobRows(organizationId, job.id, jobRows);

      const summary = {
        totalRows: rows.length,
        valid: validCount,
        invalid: invalidCount,
        skipped: skippedCount,
      };

      await storage.updateImportJobStatus(organizationId, job.id, {
        status: 'validated',
        applyMode,
        summaryJson: summary,
      });

      const invalidRows = jobRows.filter((r) => r.status === 'invalid').slice(0, 100);

      res.json({
        success: true,
        data: {
          job: { ...job, summaryJson: summary, applyMode },
          summary,
          invalidPreview: invalidRows.map((r) => ({ rowNumber: r.rowNumber, error: r.error })),
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error?.statusCode === 400) {
        return res.status(400).json({ message: error.message, errors: (error.errors || []).map((e: any) => e.message) });
      }
      console.error('Error validating import job:', error);
      res.status(500).json({ message: 'Failed to validate import job' });
    }
  });

  app.get('/api/import/jobs/:id', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });
      const job = await storage.getImportJob(organizationId, req.params.id);
      if (!job) return res.status(404).json({ message: 'Import job not found' });
      const rows = await storage.listImportJobRows(organizationId, job.id, { limit: 200 });
      res.json({ success: true, data: { job, rows } });
    } catch (error) {
      console.error('Error fetching import job:', error);
      res.status(500).json({ message: 'Failed to fetch import job' });
    }
  });

  app.post('/api/import/jobs/:id/apply', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const bodySchema = z.object({
        applyMode: z.enum(['MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES']).optional(),
      });
      const body = bodySchema.parse(req.body ?? {});

      const job = await storage.getImportJob(organizationId, req.params.id);
      if (!job) return res.status(404).json({ message: 'Import job not found' });

      const applyMode: ImportApplyMode = (body.applyMode ?? (job.applyMode as any) ?? 'MERGE_RESPECT_OVERRIDES');
      const rows = await storage.listImportJobRows(organizationId, job.id, { limit: 5000 });

      const validRows = rows.filter((r: any) => r.status === 'valid');

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const appliedRowIds: string[] = [];
      const applyErrors: Array<{ rowNumber: number; error: string }> = [];

      if (job.resource === 'customers') {
        for (const r of validRows) {
          const normalized = (r.normalizedJson || {}) as any;
          const identifiers = normalized.identifiers || {};
          const customerId = (identifiers.customerId || '').trim();

          try {
            // Build patch from normalized data.
            const { identifiers: _ident, ...customerPatchRaw } = normalized;

            // Ensure we only send fields allowed by update schema.
            const parsedUpdate = updateCustomerSchema.parse(customerPatchRaw);

            let existing: any = null;
            if (customerId) {
              existing = await storage.getCustomerById(organizationId, customerId);
            } else if (parsedUpdate.externalAccountingId) {
              const list = await storage.getAllCustomers(organizationId, { search: undefined });
              existing = (list as any[]).find((c) => c.externalAccountingId === parsedUpdate.externalAccountingId) ?? null;
            } else if (parsedUpdate.email) {
              const list = await storage.getAllCustomers(organizationId, { search: parsedUpdate.email });
              existing = (list as any[]).find((c) => c.email === parsedUpdate.email) ?? null;
            }

            if (existing) {
              let patchToApply: any = parsedUpdate;

              if (applyMode === 'MERGE_RESPECT_OVERRIDES') {
                patchToApply = pickOverrideFiltered(existing, parsedUpdate);
              }

              if (applyMode === 'MERGE_AND_SET_OVERRIDES') {
                const nextOverrides = {
                  ...(existing.qbFieldOverrides || {}),
                  ...buildOverridePatch(parsedUpdate),
                };
                patchToApply = { ...parsedUpdate, qbFieldOverrides: nextOverrides };
              }

              await storage.updateCustomer(organizationId, existing.id, patchToApply);
              updated++;
            } else {
              const parsedCreate = insertCustomerSchemaRefined.parse(customerPatchRaw);
              const createdResult = await storage.createCustomerWithPrimaryContact(organizationId, {
                customer: parsedCreate,
                primaryContact: null,
              });
              created++;

              if (applyMode === 'MERGE_AND_SET_OVERRIDES') {
                const nextOverrides = buildOverridePatch(parsedCreate);
                await storage.updateCustomer(organizationId, (createdResult as any).customer?.id ?? (createdResult as any).id, {
                  qbFieldOverrides: nextOverrides,
                });
              }
            }

            appliedRowIds.push(r.id);
          } catch (err: any) {
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Apply failed');
            applyErrors.push({ rowNumber: r.rowNumber, error: message });
          }
        }
      } else if (job.resource === 'materials') {
        for (const r of validRows) {
          const normalized = (r.normalizedJson || {}) as any;
          const identifiers = normalized.identifiers || {};
          const materialId = (identifiers.materialId || '').trim();

          try {
            const { identifiers: _ident, ...materialPatchRaw } = normalized;

            if (materialId) {
              const parsedUpdate = updateMaterialSchema.parse(materialPatchRaw);
              await storage.updateMaterial(organizationId, materialId, parsedUpdate);
              updated++;
            } else {
              const parsedCreate = insertMaterialSchema.parse(materialPatchRaw);
              const { organizationId: _orgId, ...materialData } =
                parsedCreate as typeof parsedCreate & { organizationId?: string };
              await storage.createMaterial(organizationId, materialData);
              created++;
            }

            appliedRowIds.push(r.id);
          } catch (err: any) {
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Apply failed');
            applyErrors.push({ rowNumber: r.rowNumber, error: message });
          }
        }
      } else {
        skipped = validRows.length;
      }

      await storage.markImportRowsApplied(organizationId, appliedRowIds);
      await storage.updateImportJobStatus(organizationId, job.id, {
        status: applyErrors.length > 0 ? 'error' : 'applied',
        applyMode,
        summaryJson: {
          ...(job.summaryJson as any),
          applied: { created, updated, skipped, appliedRows: appliedRowIds.length, errors: applyErrors.length },
        },
      });

      res.json({
        success: true,
        data: {
          jobId: job.id,
          applyMode,
          results: { created, updated, skipped, appliedRows: appliedRowIds.length, errors: applyErrors },
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error('Error applying import job:', error);
      res.status(500).json({ message: 'Failed to apply import job' });
    }
  });
}
