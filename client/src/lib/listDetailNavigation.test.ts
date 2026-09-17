import {
  buildDetailReturnPath,
  buildListDetailPath,
  parseDetailReturnPath,
  parseListDetailContext,
  resolveDetailBackPath,
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
});
