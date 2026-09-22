import {
  buildDetailReturnPath,
  buildOrderDetailReturnPath,
  buildListDetailPath,
  parseDetailReturnPath,
  parseOrderDetailReturnPath,
  parseListDetailContext,
  resolveDetailBackPath,
  resolveOrderDetailBackPath,
} from "@/lib/listDetailNavigationContext";

describe("list detail navigation context", () => {
  it("carries the complete invoice working-set URL and absolute row position", () => {
    const source = "/invoices?sendStatus=never_sent&jobStatus=open&sortBy=customer&sortDir=asc&page=2&pageSize=50&search=acme";
    const href = buildListDetailPath("invoice", "invoice-51", source, 50);
    const url = new URL(href, window.location.origin);

    expect(parseListDetailContext("invoice", url.searchParams)).toEqual({ source, index: 50 });
  });

  it("keeps order context separate from invoice context and preserves filters", () => {
    const source = "/orders?state=open&statusPillIds=production&sortBy=dueDate&sortDir=asc&page=3&pageSize=25";
    const href = buildListDetailPath("order", "order-72", source, 71);
    const url = new URL(href, window.location.origin);

    expect(parseListDetailContext("order", url.searchParams)).toEqual({ source, index: 71 });
    expect(parseListDetailContext("invoice", url.searchParams)).toBeNull();
  });

  it("preserves a customer return path while list navigation stays on the canonical workspace API", () => {
    const source = "/invoices?customerId=customer-1&status=unpaid&sortBy=dueDate&sortDir=asc&page=2&pageSize=50";
    const returnTo = "/customers/customer-1?tab=invoices";
    const href = buildListDetailPath("invoice", "invoice-51", source, 50, returnTo);
    const url = new URL(href, window.location.origin);

    expect(parseListDetailContext("invoice", url.searchParams)).toEqual({ source, index: 50, returnTo });
  });

  it("rejects arbitrary customer return destinations", () => {
    const href = buildListDetailPath("invoice", "invoice-1", "/invoices?customerId=customer-1", 0, "https://evil.example");
    const url = new URL(href, window.location.origin);
    expect(parseListDetailContext("invoice", url.searchParams)).toEqual({ source: "/invoices?customerId=customer-1", index: 0 });
  });

  it("rejects arbitrary or cross-workspace source URLs", () => {
    expect(parseListDetailContext("invoice", new URLSearchParams("listSource=https%3A%2F%2Fevil.example%2Finvoices&listIndex=0"))).toBeNull();
    expect(parseListDetailContext("invoice", new URLSearchParams("listSource=%2Forders%3Fstate%3Dopen&listIndex=0"))).toBeNull();
    expect(parseListDetailContext("order", new URLSearchParams("listSource=%2Forders&listIndex=-1"))).toBeNull();
  });

  it("carries customer invoice list context through an invoice-to-order round trip", () => {
    const customer = "/customers/customer-1?tab=invoices";
    const source = "/invoices?customerId=customer-1&status=unpaid&page=2&pageSize=50";
    const invoicePath = buildListDetailPath("invoice", "invoice-51", source, 50, customer);
    const orderPath = buildDetailReturnPath("/orders/order-72", invoicePath);
    const orderUrl = new URL(orderPath, window.location.origin);

    expect(parseDetailReturnPath(orderUrl.searchParams)).toBe(invoicePath);
    expect(resolveDetailBackPath(parseDetailReturnPath(orderUrl.searchParams), null, "/orders")).toBe(invoicePath);
    expect(parseListDetailContext("invoice", new URL(invoicePath, window.location.origin).searchParams)).toEqual({
      source,
      index: 50,
      returnTo: customer,
    });
  });

  it("preserves a global invoice working-set URL and edit query when opening an order", () => {
    const source = "/invoices?sendStatus=never_sent&sortBy=customer&page=2&pageSize=50";
    const invoicePath = buildListDetailPath("invoice", "invoice-51", source, 50);
    const orderPath = buildDetailReturnPath("/orders/order-72/edit?focus=pricing", invoicePath);
    const orderUrl = new URL(orderPath, window.location.origin);

    expect(orderUrl.searchParams.get("focus")).toBe("pricing");
    expect(parseDetailReturnPath(orderUrl.searchParams)).toBe(invoicePath);
    expect(resolveDetailBackPath(null, "/orders?state=open", "/orders")).toBe("/orders?state=open");
    expect(resolveDetailBackPath(null, null, "/orders")).toBe("/orders");
  });

  it("rejects external, malformed, and non-detail return paths", () => {
    for (const returnTo of [
      "https://evil.example/invoices/invoice-1",
      "//evil.example/invoices/invoice-1",
      "javascript:alert(1)",
      "/orders/order-1",
      "/settings",
      "/invoices/",
      "/invoices/invoice-1/extra",
    ]) {
      expect(parseDetailReturnPath(new URLSearchParams({ detailReturnTo: returnTo }))).toBeNull();
    }
  });

  it("returns to the exact filtered Orders URL, including search, sort, and page", () => {
    const source = "/orders?state=open&search=graphics&sortBy=dueDate&sortDir=desc&page=3&pageSize=25";
    const detail = buildListDetailPath("order", "order-72", source, 71);
    const context = parseListDetailContext("order", new URL(detail, window.location.origin).searchParams);
    expect(resolveOrderDetailBackPath(null, { pathname: "/orders", search: source.slice("/orders".length) }, context?.source ?? null, detail)).toBe(source);
  });

  it("returns to the customer's Orders tab or the source invoice", () => {
    const customer = "/customers/customer-1?tab=orders&search=banner";
    const source = "/orders?customerId=customer-1";
    const detail = buildListDetailPath("order", "order-72", source, 0, customer);
    const context = parseListDetailContext("order", new URL(detail, window.location.origin).searchParams);
    expect(resolveOrderDetailBackPath(null, null, context?.returnTo ?? null, detail)).toBe(customer);
    const invoice = "/invoices/invoice-51?listSource=%2Finvoices%3Fpage%3D2&listIndex=50";
    expect(resolveOrderDetailBackPath(invoice, null, context?.returnTo ?? null, detail)).toBe(invoice);
  });

  it("uses a safe internal referrer for other workflows and falls back for direct or external entry", () => {
    const current = "/orders/order-72";
    expect(resolveOrderDetailBackPath(null, { pathname: "/production", search: "?station=flatbed" }, null, current)).toBe("/production?station=flatbed");
    expect(resolveOrderDetailBackPath(null, null, null, current)).toBe("/orders");
    expect(resolveOrderDetailBackPath(null, { pathname: "https://outside.example/" }, null, current)).toBe("/orders");
    expect(resolveOrderDetailBackPath(null, { pathname: "//outside.example/" }, null, current)).toBe("/orders");
    expect(resolveOrderDetailBackPath(null, { pathname: "/orders/order-72", search: "?focus=pricing" }, null, current)).toBe("/orders");
  });

  it("carries the exact internal source through a full page Order link", () => {
    const source = "/production?station=flatbed&view=queue#job-4";
    const href = buildOrderDetailReturnPath("/orders/order-72", source);
    expect(parseOrderDetailReturnPath(new URL(href, window.location.origin).searchParams)).toBe(source);
    expect(buildOrderDetailReturnPath("/orders/order-72", "https://outside.example/")).toBe("/orders/order-72");
    expect(parseOrderDetailReturnPath(new URLSearchParams({ orderReturnTo: "//outside.example/" }))).toBeNull();
    expect(parseOrderDetailReturnPath(new URLSearchParams({ orderReturnTo: "/orders/order-72" }))).toBeNull();
  });
});
