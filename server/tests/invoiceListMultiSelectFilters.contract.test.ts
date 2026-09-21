import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

describe("Invoice list multi-select filter contract", () => {
  it("normalizes legacy and CSV categorical request values before the canonical list read", async () => {
    const routes = await source("server/routes/mvpInvoicing.routes.ts");
    expect(routes).toContain("function invoiceListQueryValues");
    expect(routes).toContain("item.split(',')");
    expect(routes).toContain("status: statusValues?.length === 1 ? statusValues[0] : undefined");
    expect(routes).toContain("statuses: statusValues && statusValues.length > 1 ? statusValues : undefined");
  });

  it("uses OR inside categorical dimensions while retaining independent where clauses across dimensions", async () => {
    const service = await source("server/invoicesService.ts");
    expect(service).toContain("const statusPredicates = requestedStatuses.map");
    expect(service).toContain("const accountingApprovalPredicates = categoricalValues(columnFilters.accountingApproval)");
    expect(service).toContain("const sendStatusPredicates = categoricalValues(columnFilters.sendStatus)");
    expect(service).toContain("whereClauses.push(or(...accountingApprovalPredicates))");
    expect(service).toContain("whereClauses.push(or(...sendStatusPredicates))");
    expect(service).toContain("if (sendStatusPredicates.length > 1)");
    expect(service).toContain("if (accountingApprovalPredicates.length > 1)");
  });

  it("does not emit an empty categorical predicate", async () => {
    const service = await source("server/invoicesService.ts");
    expect(service).toContain("if (jobStatusPredicates.length === 1)");
    expect(service).toContain("if (statusPredicates.length === 1)");
    expect(service).toContain("if (sendStatusPredicates.length === 1)");
  });

  it("keeps exact displayed Job Status values separate while preserving legacy open and complete semantics", async () => {
    const service = await source("server/invoicesService.ts");
    const routes = await source("server/routes/mvpInvoicing.routes.ts");
    expect(routes).toContain("['open', 'complete', 'job_complete', 'new', 'in_production', 'on_hold', 'ready_for_shipment', 'production_complete', 'fulfillment_complete', 'closed', 'cancelled'");
    expect(service).toContain("function canonicalDisplayedJobStatusExpression()");
    expect(service).toContain("return canonicalDisplayedJobStatusExpression();");
    expect(service).toContain("fulfillment_complete: 'fulfillment complete'");
    expect(service).toContain("production_complete: 'production complete'");
    expect(service).toContain("if (status === 'open')");
    expect(service).toContain("if (status === 'complete')");
    expect(service).toContain("const jobStatusPredicates = categoricalValues(columnFilters.jobStatus)");
  });

  it("uses guarded include and exclude predicates and makes exclude win for conflicting legacy URLs", async () => {
    const service = await source("server/invoicesService.ts");
    expect(service).toContain(".filter((id) => !excludedCustomerIds.includes(id))");
    expect(service).toContain("if (customerIds.length === 1)");
    expect(service).toContain("if (customerIds.length > 1)");
    expect(service).toContain("if (excludedCustomerIds.length === 1)");
    expect(service).toContain("if (excludedCustomerIds.length > 1)");
    expect(service).toContain("notInArray(canonicalInvoiceCustomerId, excludedCustomerIds)");
  });

  it("computes optional dashboard facts from the same server-side where clauses as rows and counts", async () => {
    const service = await source("server/invoicesService.ts");
    const routes = await source("server/routes/mvpInvoicing.routes.ts");
    expect(service).toContain("const summaryPromise: Promise<InvoiceDashboardSummary | undefined> = opts.includeSummary");
    expect(service).toContain(".where(and(...whereClauses))");
    expect(routes).toContain("includeSummary,");
    expect(routes).toContain("const summary = includeSummary ? invoicePage.summary ?? null : null");
  });
});
