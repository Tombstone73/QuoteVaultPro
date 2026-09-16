import { buildListDetailPath, parseListDetailContext } from "@/lib/listDetailNavigationContext";

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
});
