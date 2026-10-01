import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { renderShippingDocumentHtml } from "../../shared/shippingDocumentRendering";
import type { ShippingDocumentSource, ShippingParty } from "../../shared/shippingDocuments";

const select = jest.fn();
const rootSelect = jest.fn((...args: unknown[]) => select(...args));
const transactionSelect = jest.fn((...args: unknown[]) => select(...args));
const transaction = jest.fn();
const nestedTransaction = jest.fn(() => { throw new Error("Source must not nest transactions"); });
const write = jest.fn(() => { throw new Error("Document reads must never write"); });
const resolveContext = jest.fn();
const executor = { select: transactionSelect, transaction: nestedTransaction, insert: write, update: write, delete: write };
const mockDb = { select: rootSelect, transaction, insert: write, update: write, delete: write };
jest.unstable_mockModule("../db", () => ({ db: mockDb }));
jest.unstable_mockModule("../services/fulfillment/shippingContext", () => ({ resolveShipmentShippingContext: resolveContext }));
const { getShippingDocumentSource } = await import("../services/shippingDocumentService");

const party = (company: string): ShippingParty => ({ name: null, company, address1: "123 Saved Street", address2: null,
  city: "Saved City", state: "CA", postalCode: "90001", country: "US", phone: null, email: null });
function source(): ShippingDocumentSource {
  const line = { orderId: "ORDER_ID_PRIVATE", orderLineItemId: "LINE_ID_PRIVATE", description: "Approved saved item", quantity: 5, size: '24" x 18"', material: "Saved Coroplast" };
  return { version: 1, basis: "shipped", capturedAt: "2026-10-01T18:00:00.000Z", organizationId: "ORG_ID_PRIVATE", shipmentId: "shipment",
    shipmentReference: "SHIPMENT_PRIVATE", shipDate: "2026-10-01", carrier: "CARRIER_PRIVATE", serviceLevel: "SERVICE_PRIVATE", trackingNumber: "TRACKING_PRIVATE",
    destination: party("Approved recipient"), blindShipping: true, sender: party("Approved blind sender"),
    orders: [{ id: line.orderId, orderNumber: "20538", customerId: "CUSTOMER_ID_PRIVATE", customerName: "CUSTOMER_NAME_PRIVATE", poNumber: "PO-APPROVED" }],
    lines: [line], packages: [
      { id: "package-1", ordinal: 1, packageReference: "PACKAGE_ONE", weightLbs: "4", dimLengthIn: "24", dimWidthIn: "18", dimHeightIn: "2", internalNotes: "PACKAGE_NOTE_PRIVATE", lines: [{ ...line, quantity: 2 }] },
      { id: "package-2", ordinal: 2, packageReference: "PACKAGE_TWO", weightLbs: "3", dimLengthIn: "24", dimWidthIn: "18", dimHeightIn: "2", internalNotes: null, lines: [{ ...line, quantity: 1 }] },
    ], internalNotes: "SHIPMENT_NOTE_PRIVATE" };
}

describe("shipping document renderer", () => {
  test("packing slip whitelists approved sender/destination/order/PO and actual quantities only", () => {
    const input = Object.assign(source(), { actualOrganizationName: "ACTUAL_ORG_PRIVATE", price: "PRICE_PRIVATE", history: "HISTORY_PRIVATE" });
    const html = renderShippingDocumentHtml(input, "packing_slip");
    for (const approved of ["Approved blind sender", "Approved recipient", "Approved saved item", "Saved Coroplast", "PO-APPROVED", "20538"]) expect(html).toContain(approved);
    for (const forbidden of ["ORG_ID_PRIVATE", "ORDER_ID_PRIVATE", "LINE_ID_PRIVATE", "CUSTOMER_ID_PRIVATE", "CUSTOMER_NAME_PRIVATE", "PACKAGE_NOTE_PRIVATE", "SHIPMENT_NOTE_PRIVATE", "ACTUAL_ORG_PRIVATE", "PRICE_PRIVATE", "HISTORY_PRIVATE", "SHIPMENT_PRIVATE", "CARRIER_PRIVATE", "SERVICE_PRIVATE", "TRACKING_PRIVATE"]) expect(html).not.toContain(forbidden);
    expect(html).toContain("<strong>Qty</strong><p>5</p>");
    expect(html).toContain("Not an invoice");
    expect(html).toContain("@page");
    expect(html).toContain("size: 80mm auto");
    expect(html).not.toMatch(/<script|<img|https?:\/\//);
  });

  test.each(["packing_slip", "shipment_manifest", "package_ticket"] as const)("%s escapes all user text including size and dimensions", (type) => {
    const input = source();
    const sentinel = `<img src=x onerror="alert('x')">&`;
    input.sender.company = sentinel; input.destination.address1 = sentinel; input.orders[0].orderNumber = sentinel;
    input.orders[0].poNumber = sentinel; input.orders[0].customerName = sentinel;
    input.shipmentReference = sentinel; input.carrier = sentinel; input.internalNotes = sentinel;
    input.lines[0] = { ...input.lines[0], description: sentinel, size: sentinel, material: sentinel };
    for (const pkg of input.packages) { pkg.packageReference = sentinel; pkg.dimWidthIn = sentinel; pkg.internalNotes = sentinel; pkg.lines[0] = { ...input.lines[0], quantity: 1 }; }
    const html = renderShippingDocumentHtml(input, type);
    expect(html).not.toContain(sentinel); expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
  });

  test("manifest separates total quantities, package splits, unpacked balance and internal notes", () => {
    const input = source();
    const before = JSON.stringify(input);
    const html = renderShippingDocumentHtml(input, "shipment_manifest");
    expect(html).toContain("Actual shipment items"); expect(html).toContain("Unpacked shipment items");
    expect(html).toContain("PACKAGE_NOTE_PRIVATE"); expect(html).toContain("SHIPMENT_NOTE_PRIVATE");
    expect(html).toContain("CUSTOMER_NAME_PRIVATE");
    expect(html.match(/<td class="qty">2<\/td>/g)).toHaveLength(2);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("package tickets use separate print pages and only the selected package quantities", () => {
    const input = source();
    const html = renderShippingDocumentHtml(input, "package_ticket");
    expect(html.match(/<section class="ticket">/g)).toHaveLength(2);
    expect(html).toContain("break-after: page"); expect(html).toContain("Weight: 4 lb"); expect(html).toContain("Dimensions: 24 x 18 x 2 in");
    expect(html).not.toContain("PACKAGE_NOTE_PRIVATE"); expect(html).not.toContain("SHIPMENT_NOTE_PRIVATE");
    const selected = renderShippingDocumentHtml(input, "package_ticket", { packageId: "package-2" });
    expect(selected).toContain("PACKAGE_TWO"); expect(selected).not.toContain("PACKAGE_ONE");
    expect(selected).toContain('<td class="qty">1</td>'); expect(selected).not.toContain('<td class="qty">5</td>');
    expect(() => renderShippingDocumentHtml(input, "package_ticket", { packageId: "other-tenant-package" })).toThrow("does not belong");
    expect(() => renderShippingDocumentHtml(input, "packing_slip", { packageId: "package-1" })).toThrow("only supported");
  });

  test.each(["packing_slip", "shipment_manifest", "package_ticket"] as const)("%s blocks blind rendering without explicit sender identity", (type) => {
    const input = source(); input.sender.name = null; input.sender.company = null;
    expect(() => renderShippingDocumentHtml(input, type)).toThrow("alternate sender identity");
  });
});

type PredicateRead = { table: string; sql: string; params: unknown[] };
const reads: PredicateRead[] = [];
const dialect = new PgDialect();
function mockReads(results: unknown[][]) {
  let index = 0;
  select.mockImplementation(() => {
    const result = results[index++];
    if (!result) throw new Error("Unexpected live lookup");
    let table = "";
    const chain: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    chain.from = (value: any) => { table = getTableName(value); return chain; };
    chain.where = (value: any) => { reads.push({ table, ...dialect.sqlToQuery(value) }); return chain; };
    for (const method of ["leftJoin", "innerJoin"]) chain[method] = (_table: unknown, predicate: any) => { reads.push({ table, ...dialect.sqlToQuery(predicate) }); return chain; };
    for (const method of ["limit", "orderBy"]) chain[method] = () => chain;
    return chain;
  });
}
const context = { version: 1, source: "order", sourceOrderId: "order", destination: party("Saved recipient"), blindShipping: false, blindSender: null };
const draft = { id: "shipment", organizationId: "org", status: "DRAFT", shippingContext: context, documentSnapshot: null,
  shipmentReference: "SH-1", shipDate: null, carrier: null, serviceLevel: null, trackingNumber: null, internalNotes: "Private operational note" };
function draftResults(overrides?: { shipment?: any; allocations?: any[]; line?: any }) {
  return [[overrides?.shipment ?? draft], [{ orderId: "order" }], [{ id: "order", orderNumber: "20538", displayNumber: null, poNumber: "PO-1", customerId: "customer", customerName: "Internal customer" }],
    [{ companyName: "Approved organization sender", address: "Legacy sender address", physicalAddress: { line1: "Sender Street", city: "Sender City", postalCode: "10000" }, phone: null, email: null }], [{ name: "ACTUAL_ORG_PRIVATE", settings: {} }],
    overrides?.allocations ?? [{ id: "a1", orderId: "order", orderLineItemId: "line", packageId: "package", quantity: 2 }, { id: "a2", orderId: "order", orderLineItemId: "line", packageId: null, quantity: 1 }],
    [{ id: "package", ordinal: 1, packageReference: "PK-1", weightLbs: "4", dimLengthIn: "24", dimWidthIn: "18", dimHeightIn: "2", notes: "Package private" }],
    [overrides?.line ?? { id: "line", orderId: "order", description: "Persisted description", width: "24", height: "18", materialId: null, materialUsageJson: [{ materialName: "Persisted material" }], materialUsages: [], selectedOptions: [], quantity: 999 }]];
}

beforeEach(() => {
  select.mockReset(); rootSelect.mockClear(); transactionSelect.mockClear(); nestedTransaction.mockClear();
  transaction.mockReset().mockImplementation(async (callback: any) => callback(executor));
  write.mockClear(); resolveContext.mockReset(); reads.length = 0;
});

describe("shipping document sources with mocked database", () => {
  test.each([undefined, { captureForShipping: false }])("default preview/enqueue uses one repeatable-read read-only boundary for every source query: %j", async (options) => {
    resolveContext.mockImplementation(async () => context);
    const results = draftResults({ shipment: { ...draft, shippingContext: null }, line: {
      id: "line", orderId: "order", description: "Persisted description", width: "24", height: "18", materialId: "material",
      materialUsageJson: [{ materialName: "Persisted material" }], materialUsages: [], selectedOptions: [],
    } });
    results.push([{ id: "material", name: "Catalog material" }]);
    mockReads(results);
    const document = await getShippingDocumentSource("org", "shipment", undefined, options);
    expect(document.basis).toBe("draft");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(rootSelect).not.toHaveBeenCalled(); expect(transactionSelect).toHaveBeenCalledTimes(9);
    expect(resolveContext).toHaveBeenCalledWith("org", ["order"], executor);
    expect(nestedTransaction).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  test.each([undefined, { captureForShipping: false }, { captureForShipping: true }])("caller-supplied transaction is used untouched without a nested boundary: %j", async (options) => {
    resolveContext.mockImplementation(async () => context);
    mockReads(draftResults({ shipment: { ...draft, shippingContext: null } }));
    const document = await getShippingDocumentSource("org", "shipment", executor as any, options);
    expect(document.basis).toBe(options?.captureForShipping ? "shipped" : "draft");
    expect(resolveContext).toHaveBeenCalledWith("org", ["order"], executor);
    expect(transactionSelect).toHaveBeenCalledTimes(8); expect(rootSelect).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled(); expect(nestedTransaction).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  test.each(["query", "context"])("default read boundary propagates the original %s error without fallback or retry", async (failureAt) => {
    const failure = new Error(`Original ${failureAt} error`);
    if (failureAt === "query") select.mockImplementation(() => { throw failure; });
    else {
      mockReads(draftResults({ shipment: { ...draft, shippingContext: null } }));
      resolveContext.mockImplementation(async () => { throw failure; });
    }
    await expect(getShippingDocumentSource("org", "shipment")).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1); expect(rootSelect).not.toHaveBeenCalled();
    expect(nestedTransaction).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  test("default read boundary propagates transaction failure before any source reads", async () => {
    const failure = new Error("Read transaction unavailable");
    transaction.mockImplementation(async () => { throw failure; });
    await expect(getShippingDocumentSource("org", "shipment")).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1); expect(select).not.toHaveBeenCalled();
    expect(rootSelect).not.toHaveBeenCalled(); expect(nestedTransaction).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  test("DRAFT uses persisted saved allocations, not ordered/remaining quantity or live product labels", async () => {
    mockReads(draftResults());
    const document = await getShippingDocumentSource("org", "shipment");
    expect(document).toMatchObject({ basis: "draft", shipDate: null, sender: { company: "Approved organization sender", address1: "Sender Street" }, destination: context.destination });
    expect(document.lines).toEqual([expect.objectContaining({ description: "Persisted description", quantity: 3, material: "Persisted material", size: '24" x 18"' })]);
    expect(document.packages[0].lines[0].quantity).toBe(2);
    expect(resolveContext).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    for (const table of ["shipments", "shipment_orders", "orders", "company_settings", "organizations", "shipment_items", "shipment_packages"]) {
      expect(reads.some((read) => read.table === table && read.params.includes("org"))).toBe(true);
    }
    const linePredicates = reads.filter((read) => read.table === "order_line_items");
    expect(linePredicates.some((read) => read.params.includes("org") && read.sql.includes('"orders"."organization_id"'))).toBe(true);
    expect(linePredicates.some((read) => read.params.includes("order") && read.params.includes("line"))).toBe(true);
  });

  test("capture produces shipped basis with canonical current UTC date without any source writes", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-02T00:15:00.000Z"));
    try {
      mockReads(draftResults());
      const document = await getShippingDocumentSource("org", "shipment", undefined, { captureForShipping: true });
      expect(document.basis).toBe("shipped"); expect(document.shipDate).toBe("2026-10-02");
      expect(transaction).not.toHaveBeenCalled(); expect(transactionSelect).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  test("persisted material label wins over mutable tenant-scoped catalog name", async () => {
    const results = draftResults({ line: { id: "line", orderId: "order", description: "Persisted description", width: "24", height: "18", materialId: "material", materialUsageJson: [{ materialName: "Persisted material" }], materialUsages: [], selectedOptions: [] } });
    results.push([{ id: "material", name: "LIVE_EDIT_NOT_APPROVED" }]);
    mockReads(results);
    const document = await getShippingDocumentSource("org", "shipment");
    expect(document.lines[0].material).toBe("Persisted material");
    const materialRead = reads.find((read) => read.table === "materials")!;
    expect(materialRead.params).toEqual(["org", "material"]); expect(write).not.toHaveBeenCalled();
  });

  test("capture honors the supplied transaction executor and blocks incomplete destination before further reads", async () => {
    const transactionSelect = jest.fn(() => select());
    const executor = { select: transactionSelect, insert: write, update: write, delete: write } as any;
    mockReads(draftResults({ shipment: { ...draft, shippingContext: { ...context, destination: { ...context.destination, address1: null } } } }));
    await expect(getShippingDocumentSource("org", "shipment", executor, { captureForShipping: true })).rejects.toMatchObject({ status: 409, code: "SHIPPING_DESTINATION_REQUIRED" });
    expect(transactionSelect).toHaveBeenCalledTimes(3); expect(write).not.toHaveBeenCalled();
  });

  test("missing draft context alone calls the shared resolver and capture retains an explicit date", async () => {
    resolveContext.mockImplementation(async () => context);
    mockReads(draftResults({ shipment: { ...draft, shippingContext: null, shipDate: new Date("2026-09-30T00:00:00Z") } }));
    const document = await getShippingDocumentSource("org", "shipment", undefined, { captureForShipping: true });
    expect(resolveContext).toHaveBeenCalledWith("org", ["order"], mockDb);
    expect(document.shipDate).toBe("2026-09-30"); expect(write).not.toHaveBeenCalled();
  });

  test("blind sender is the sole effective sender and does not consult organization settings", async () => {
    const blindContext = { ...context, blindShipping: true, blindSender: party("Alternate blind sender") };
    const results = draftResults({ shipment: { ...draft, shippingContext: blindContext } });
    results.splice(3, 2);
    mockReads(results);
    const document = await getShippingDocumentSource("org", "shipment");
    expect(document.sender).toEqual(blindContext.blindSender);
    expect(reads.some((read) => read.table === "organizations" || read.table === "company_settings")).toBe(false);
    const html = renderShippingDocumentHtml(document, "packing_slip");
    expect(html).toContain("Alternate blind sender"); expect(html).not.toContain("Internal customer"); expect(html).not.toContain("Private operational note");
  });

  test("blind shipping without alternate identity blocks documents, never falls back to actual organization", async () => {
    mockReads(draftResults({ shipment: { ...draft, shippingContext: { ...context, blindShipping: true } } }));
    await expect(getShippingDocumentSource("org", "shipment")).rejects.toMatchObject({ status: 409, code: "BLIND_SENDER_REQUIRED" });
    expect(select).toHaveBeenCalledTimes(3); expect(write).not.toHaveBeenCalled();
  });

  test.each([
    { orderId: "other-order", orderLineItemId: "line", packageId: "package", quantity: 1 },
    { orderId: "order", orderLineItemId: "line", packageId: "other-tenant-package", quantity: 1 },
    { orderId: "order", orderLineItemId: "missing-line", packageId: "package", quantity: 1 },
  ])("rejects saved allocation outside linked Order/item/package ownership: %j", async (allocation) => {
    mockReads(draftResults({ allocations: [allocation] }));
    await expect(getShippingDocumentSource("org", "shipment")).rejects.toMatchObject({ status: 409, code: "SHIPPING_SOURCE_INVALID" });
    expect(write).not.toHaveBeenCalled();
  });

  test("SHIPPED reprints remain frozen after mutable data edits/corrections and perform only scoped shipment lookup", async () => {
    const saved = source(); saved.organizationId = "org";
    mockReads([[{ ...draft, status: "SHIPPED", documentSnapshot: saved, shippingContext: { ...context, destination: party("LIVE_EDIT_NOT_ALLOWED") } }]]);
    const document = await getShippingDocumentSource("org", "shipment");
    expect(document).toEqual(saved); expect(select).toHaveBeenCalledTimes(1); expect(resolveContext).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1); expect(transactionSelect).toHaveBeenCalledTimes(1); expect(rootSelect).not.toHaveBeenCalled();
    document.lines[0].description = "Caller edit";
    expect(saved.lines[0].description).toBe("Approved saved item");
  });

  test("SHIPPED source in a caller transaction short-circuits without new boundary or live reads", async () => {
    const saved = source(); saved.organizationId = "org";
    mockReads([[{ ...draft, status: "SHIPPED", documentSnapshot: saved }]]);
    expect(await getShippingDocumentSource("org", "shipment", executor as any)).toEqual(saved);
    expect(transactionSelect).toHaveBeenCalledTimes(1); expect(rootSelect).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled(); expect(nestedTransaction).not.toHaveBeenCalled();
    expect(resolveContext).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });

  test.each([null, { version: 99 }, { ...source(), organizationId: "other-org" }, { ...source(), shipmentId: "other-shipment" }])("old/invalid SHIPPED source explicitly unavailable with no live backfill: %j", async (snapshot) => {
    mockReads([[{ ...draft, status: "SHIPPED", documentSnapshot: snapshot }]]);
    await expect(getShippingDocumentSource("org", "shipment")).rejects.toMatchObject({ status: 409, code: "HISTORICAL_SNAPSHOT_UNAVAILABLE", message: "Historical shipping document snapshot unavailable." });
    expect(select).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled(); expect(resolveContext).not.toHaveBeenCalled();
  });

  test("tenant-scoped absent shipment is 404, not a live lookup", async () => {
    mockReads([[]]);
    await expect(getShippingDocumentSource("other-org", "shipment")).rejects.toMatchObject({ status: 404 });
    expect(reads[0].params).toEqual(["other-org", "shipment"]); expect(select).toHaveBeenCalledTimes(1);
  });
});
