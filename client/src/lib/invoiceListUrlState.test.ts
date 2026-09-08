import { parseInvoiceListUrlState, updateInvoiceListUrlState } from "@/lib/invoiceListUrlState";

describe("Invoice list URL state", () => {
  it("restores the complete backlog working set from the URL", () => {
    const state = parseInvoiceListUrlState(new URLSearchParams("customerId=customer-1&customerName=Brainstorm+Print&sendStatus=never_sent&accountingApproval=not_approved&issueDateFrom=2026-08-01&issueDateTo=2026-09-07&issueDatePreset=custom&page=3&pageSize=100&search=ACM&sortBy=customer&sortDir=asc"));

    expect(state).toMatchObject({
      customerId: "customer-1", customerName: "Brainstorm Print", issueDatePreset: "custom", search: "ACM", page: 3, pageSize: 100,
      sortKey: "customer", sortDir: "asc",
      columnFilters: { sendStatus: "never_sent", accountingApproval: "not_approved", issueDateFrom: "2026-08-01", issueDateTo: "2026-09-07" },
    });
  });

  it("resets only pagination when a material filter changes", () => {
    const next = updateInvoiceListUrlState(new URLSearchParams("customerId=customer-1&page=4&pageSize=50"), { sendStatus: "never_sent" }, true);
    expect(next.toString()).toBe("customerId=customer-1&pageSize=50&sendStatus=never_sent");
  });

  it("removes only the requested chip filter", () => {
    const next = updateInvoiceListUrlState(new URLSearchParams("customerId=customer-1&sendStatus=never_sent&accountingApproval=not_approved"), { sendStatus: undefined });
    expect(next.toString()).toBe("customerId=customer-1&accountingApproval=not_approved");
  });
});
