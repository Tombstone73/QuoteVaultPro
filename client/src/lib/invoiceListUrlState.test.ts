import { hasExplicitInvoiceListFilters, normalizeInvoiceListSearchQuery, parseInvoiceListUrlState, updateInvoiceListUrlState } from "@/lib/invoiceListUrlState";

describe("Invoice list URL state", () => {
  it.each([
    ["Metro", "Metro"],
    ["Metro Area", "Metro Area"],
    ["Metro ", "Metro "],
    ["Metro Area Printing", "Metro Area Printing"],
    ["20 x 30 PVC", "20 x 30 PVC"],
  ])("preserves the live search input %j", (input, expected) => {
    const params = new URLSearchParams({ search: input });
    expect(parseInvoiceListUrlState(params).search).toBe(expected);
  });

  it("preserves an in-progress trailing space in the URL and resets the page", () => {
    const next = updateInvoiceListUrlState(new URLSearchParams("page=4&pageSize=50&sortBy=customer&sortDir=asc&sendStatus=never_sent"), { search: "Metro " }, true);
    expect(next.get("search")).toBe("Metro ");
    expect(next.toString()).toContain("search=Metro+");
    expect(next.has("page")).toBe(false);
    expect(next.get("pageSize")).toBe("50");
    expect(next.get("sortBy")).toBe("customer");
    expect(next.get("sortDir")).toBe("asc");
    expect(next.get("sendStatus")).toBe("never_sent");
  });

  it("trims only at the API query boundary and clears whitespace-only URL searches", () => {
    expect(normalizeInvoiceListSearchQuery("Metro ")).toBe("Metro");
    expect(normalizeInvoiceListSearchQuery("  Metro Area Printing  ")).toBe("Metro Area Printing");
    expect(normalizeInvoiceListSearchQuery("Brainstorm Print")).toBe("Brainstorm Print");
    expect(normalizeInvoiceListSearchQuery("   ")).toBeUndefined();
    const next = updateInvoiceListUrlState(new URLSearchParams("search=Metro&page=2"), { search: "   " }, true);
    expect(next.has("search")).toBe(false);
    expect(next.has("page")).toBe(false);
  });
  it("restores the complete backlog working set from the URL", () => {
    const state = parseInvoiceListUrlState(new URLSearchParams("customerId=customer-1&customerName=Brainstorm+Print&excludeCustomerId=customer-2&excludeCustomerName=Graphic+Solutions&jobStatus=open&sendStatus=never_sent&accountingApproval=not_approved&issueDateFrom=2026-08-01&issueDateTo=2026-09-07&issueDatePreset=custom&includePaidHistorical=1&page=3&pageSize=100&search=ACM&sortBy=customer&sortDir=asc"));

    expect(state).toMatchObject({
      customerId: "customer-1", customerName: "Brainstorm Print", excludeCustomerName: "Graphic Solutions", issueDatePreset: "custom", search: "ACM", page: 3, pageSize: 100,
      includePaidHistorical: true, sortKey: "customer", sortDir: "asc",
      columnFilters: { excludeCustomerId: "customer-2", jobStatus: "open", sendStatus: "never_sent", accountingApproval: "not_approved", issueDateFrom: "2026-08-01", issueDateTo: "2026-09-07" },
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

  it("uses an explicit valid URL sort but marks an absent or invalid sort for preference fallback", () => {
    expect(parseInvoiceListUrlState(new URLSearchParams("sortBy=balance&sortDir=asc"))).toMatchObject({
      hasExplicitSort: true, sortKey: "balance", sortDir: "asc",
    });
    expect(parseInvoiceListUrlState(new URLSearchParams("sortBy=not-real&sortDir=asc"))).toMatchObject({
      hasExplicitSort: false, sortKey: "issueDate", sortDir: "desc",
    });
  });

  it("accepts every configurable Global Invoice sort field", () => {
    expect(parseInvoiceListUrlState(new URLSearchParams("sortBy=jobName&sortDir=asc"))).toMatchObject({ hasExplicitSort: true, sortKey: "jobName" });
    expect(parseInvoiceListUrlState(new URLSearchParams("sortBy=paid&sortDir=desc"))).toMatchObject({ hasExplicitSort: true, sortKey: "paid" });
  });

  it("defaults Paid Historical visibility off while preserving an explicit URL toggle", () => {
    expect(parseInvoiceListUrlState(new URLSearchParams())).toMatchObject({ includePaidHistorical: false });
    expect(updateInvoiceListUrlState(new URLSearchParams("page=3&status=paid"), { includePaidHistorical: "1" }, true).toString())
      .toBe("status=paid&includePaidHistorical=1");
  });

  it("recognizes explicit filter and drilldown parameters without treating search, paging, or sort as sticky-filter overrides", () => {
    expect(hasExplicitInvoiceListFilters(new URLSearchParams("customerId=customer-1"))).toBe(true);
    expect(hasExplicitInvoiceListFilters(new URLSearchParams("sendStatus=never_sent"))).toBe(true);
    expect(hasExplicitInvoiceListFilters(new URLSearchParams("search=ACM&page=2&pageSize=100&sortBy=customer"))).toBe(false);
  });
});
