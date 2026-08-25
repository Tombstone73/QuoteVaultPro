import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("invoice refresh-status reconciliation contract", () => {
  test("registers the client refresh route behind authenticated tenant scope", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");

    expect(route).toContain('app.post("/api/invoices/:id/refresh-status", isAuthenticated, tenantContext, ...(requireOrgOwnerAdmin ? [requireOrgOwnerAdmin] : [])');
    expect(route).toContain('const organizationId = getRequestOrganizationId(req);');
    expect(route).toContain('String((rel.invoice as any).organizationId) !== organizationId');
    expect(route).toContain('await refreshInvoiceStatus(invoiceId);');
    expect(route).toContain('withNormalizedInvoiceDisplay(refreshedRel.invoice as any, refreshedRel.payments as any)');
  });

  test("reopens stale paid state from current rollup while preserving draft and void protections", () => {
    const invoicesService = source("server/invoicesService.ts");
    const rollup = source("shared/rollups/invoicePaymentRollup.ts");

    expect(invoicesService).toContain('getInvoiceFinancialLifecycleStatus');
    expect(rollup).toContain("if (currentStatus === 'draft') return 'draft';");
    expect(rollup).toContain("if (currentStatus === 'void' || currentStatus === 'voided') return 'void';");
    expect(rollup).toContain("if (paid > 0) return 'partially_paid';");
    expect(rollup).toContain("return 'billed';");
  });
});
