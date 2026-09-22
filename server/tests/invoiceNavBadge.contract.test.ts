import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("invoice navigation badge", () => {
  test("uses the same server-side Ready to Finalize plus Never Sent count authority as the Invoice page", () => {
    const summary = read("server/services/operationalSummary.ts");
    const invoiceService = read("server/invoicesService.ts");

    expect(summary).toContain("listInvoicesPageForOrganization({");
    expect(summary).toContain('jobStatus: ["job_complete", "fulfillment_complete"]');
    expect(summary).toContain('sendStatus: "never_sent"');
    expect(summary).toContain("includePaidHistorical: false");
    expect(summary).toContain("includeCanceled: false");
    expect(summary).toContain("readyToFinalizeNeverSent: readyToFinalizeNeverSentPage.totalCount");
    expect(invoiceService).toContain("const countQuery = db");
    expect(invoiceService).toContain("where(and(...whereClauses))");
  });

  test("keeps the canonical Ready to Finalize statuses and Never Sent definition unchanged", () => {
    const invoiceService = read("server/invoicesService.ts");

    expect(invoiceService).toContain("job_complete: 'complete'");
    expect(invoiceService).toContain("fulfillment_complete: 'fulfillment complete'");
    expect(invoiceService).toContain("if (sendStatus === 'never_sent') return sql");
  });

  test("maps the new count to the Invoices badge and refreshes it after Close Job Override", () => {
    const sidebar = read("client/src/components/layout/TitanSidebarNav.tsx");
    const closeOverride = read("client/src/components/orders/CloseJobOverrideDialog.tsx");

    expect(sidebar).toContain("invoices: safeSummary.invoices.readyToFinalizeNeverSent ?? 0");
    expect(closeOverride).toContain('queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] })');
  });
});
