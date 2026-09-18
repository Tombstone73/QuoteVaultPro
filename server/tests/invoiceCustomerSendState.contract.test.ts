import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

describe("canonical Invoice customer-send state", () => {
  it("preserves manual checkpoints as Invoice-row evidence without creating email logs", async () => {
    const service = await source("server/invoicesService.ts");
    const start = service.indexOf("async function markInvoiceSentCanonicalInTransaction");
    const operation = service.slice(start, service.indexOf("export async function markInvoiceSentCanonical", start));

    expect(operation).toContain("lastSentAt: now");
    expect(operation).toContain("lastSentVersion: invoiceVersion");
    expect(operation).toContain("lastSentVia: via");
    expect(operation).toContain('actionType: "invoice_marked_sent"');
    expect(operation).not.toContain("invoiceEmailLogs");
  });

  it("uses the same canonical manual checkpoint for bounded bulk marks without queueing or sending email", async () => {
    const [service, routes] = await Promise.all([
      source("server/invoicesService.ts"),
      source("server/routes/mvpInvoicing.routes.ts"),
    ]);
    const start = service.indexOf("export async function markInvoicesSentCanonical");
    const operation = service.slice(start, service.indexOf("export async function appendInvoiceInternalNoteCanonical", start));
    const routeStart = routes.indexOf('app.post("/api/invoices/mark-sent/bulk"');
    const route = routes.slice(routeStart, routes.indexOf('app.post("/api/invoices/:id/mark-sent"', routeStart));

    expect(operation).toContain("markInvoiceSentCanonicalInTransaction");
    expect(operation).toContain('bulk: true');
    expect(operation).toContain('INVOICE_IMPORTED_READ_ONLY');
    expect(operation).not.toContain("invoiceEmailLogs");
    expect(route).toContain("canonicalInvoiceOperations.markSentBulk");
    expect(route).toContain('via: "manual"');
    expect(route).not.toContain("enqueueBulkInvoiceEmailCampaign");
    expect(route).not.toContain("emailService");
  });

  it("uses the Invoice checkpoint first, then legacy original-email evidence, for detail and list reads", async () => {
    const [service, routes, detail] = await Promise.all([
      source("server/invoicesService.ts"),
      source("server/routes/mvpInvoicing.routes.ts"),
      source("client/src/pages/invoice-detail.tsx"),
    ]);

    expect(service).toContain("export async function getInvoiceSendStatuses");
    expect(service).toContain("const lastSentAt = persistedLastSentAt ?? emailEvidence?.lastSentAt ?? null");
    expect(service).toContain("customerSendStatus: deriveInvoiceSendStatus");
    expect(routes).toContain("getInvoiceSendStatuses(");
    expect(routes).toContain("getInvoiceSendStatus(req.params.id)");
    expect(detail).toContain("customerSendStatus || (invoice as any)?.emailStatus");
  });

  it("keeps manual sends in canonical list filtering and Last Sent sorting", async () => {
    const service = await source("server/invoicesService.ts");

    expect(service).toContain("case 'lastSentAt':");
    expect(service).toContain("const effectiveLastSentAt = sql<Date | null>");
    expect(service).toContain("if (sendStatus === 'never_sent') return sql");
    expect(service).toContain("if (sendStatus === 'sent') return sql");
  });
});
