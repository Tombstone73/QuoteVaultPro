import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

describe("canonical Invoice customer-send state", () => {
  it("preserves manual checkpoints as Invoice-row evidence without creating email logs", async () => {
    const service = await source("server/invoicesService.ts");
    const start = service.indexOf("export async function markInvoiceSentCanonical");
    const operation = service.slice(start, service.indexOf("export async function getInvoiceWithRelations", start));

    expect(operation).toContain("lastSentAt: now");
    expect(operation).toContain("lastSentVersion: Number((invoice as any).invoiceVersion || 1)");
    expect(operation).toContain("lastSentVia: via");
    expect(operation).toContain('actionType: "invoice_marked_sent"');
    expect(operation).not.toContain("invoiceEmailLogs");
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
