import { describe, expect, test } from "@jest/globals";
import { InvoiceRepository } from "../src/billing/invoiceRepository";
import { createFixtureApplication, createFixtureDatabase } from "../src/fixtures/createFixtureApplication";
import { V2PocError } from "../src/shared/errors";

const command = (overrides: Record<string, unknown> = {}) => ({ organizationId: "org-a", customerId: "customer-a-taxable", requestId: "request-1", lines: [{ productId: "product-a-taxable", quantity: 2, selections: { finish: { value: "laminated" } } }], ...overrides });

describe("V2 modular order vertical slice", () => {
  test("prices a scoped PBV2 product through the V1-compatible pure evaluator path", async () => {
    const { operation } = createFixtureApplication();
    const result = await operation.execute("owner-a", command());
    expect(result.order.lines[0]).toMatchObject({ lineSubtotalCents: 2050, taxCents: 164, totalCents: 2214 });
    expect(result.order.lines[0].pricingSnapshot).toMatchObject({ pricingSystem: "pbv2", treeVersionId: "tree-a-1", baseCents: 2000, optionsCents: 50 });
  });

  test("creates an order and immutable draft invoice with matching cents totals", async () => {
    const { operation } = createFixtureApplication();
    const result = await operation.execute("employee-a", command({ requestId: "request-financial" }));
    expect(result.invoice).toMatchObject({ orderId: result.order.id, subtotalCents: result.order.subtotalCents, taxCents: result.order.taxCents, totalCents: result.order.totalCents });
    expect(result.invoice.lines).toEqual(result.order.lines);
  });

  test("applies organization tax only to taxable lines", async () => {
    const { operation } = createFixtureApplication();
    const result = await operation.execute("owner-a", command({ requestId: "request-multiple", lines: [{ productId: "product-a-taxable", quantity: 1, selections: { finish: { value: "standard" } } }, { productId: "product-a-nontaxable", quantity: 2, selections: { finish: { value: "standard" } } }] }));
    expect(result.order).toMatchObject({ subtotalCents: 2000, taxCents: 80, totalCents: 2080 });
  });

  test("honors tax-exempt customers", async () => {
    const { operation } = createFixtureApplication();
    const result = await operation.execute("owner-a", command({ requestId: "request-exempt", customerId: "customer-a-exempt" }));
    expect(result.order.taxCents).toBe(0);
  });

  test("rejects a membership role without orders:create", async () => {
    const { operation } = createFixtureApplication();
    await expect(operation.execute("member-a", command({ requestId: "request-member" }))).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<V2PocError>);
  });

  test("rejects an actor who guesses another organization", async () => {
    const { operation } = createFixtureApplication();
    await expect(operation.execute("owner-a", command({ organizationId: "org-b", customerId: "customer-b", requestId: "request-wrong-org", lines: [{ productId: "product-b", quantity: 1 }] }))).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<V2PocError>);
  });

  test("returns not-found for a guessed foreign customer", async () => {
    const { operation } = createFixtureApplication();
    await expect(operation.execute("owner-a", command({ customerId: "customer-b", requestId: "request-foreign-customer" }))).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
  });

  test("returns not-found for a guessed foreign product before pricing", async () => {
    const { operation } = createFixtureApplication();
    await expect(operation.execute("owner-a", command({ requestId: "request-foreign-product", lines: [{ productId: "product-b", quantity: 1 }] }))).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
  });

  test("replays a durable idempotent request after an application restart", async () => {
    const database = createFixtureDatabase();
    const first = createFixtureApplication(database).operation;
    const original = await first.execute("owner-a", command({ requestId: "request-replay" }));
    const replay = await createFixtureApplication(database).operation.execute("owner-a", command({ requestId: "request-replay" }));
    expect(replay).toMatchObject({ idempotentReplay: true, order: { id: original.order.id }, invoice: { id: original.invoice.id } });
    expect(database.snapshot().orders).toHaveLength(1);
  });

  test("rejects reuse of an idempotency key with different content", async () => {
    const { operation } = createFixtureApplication();
    await operation.execute("owner-a", command({ requestId: "request-conflict" }));
    await expect(operation.execute("owner-a", command({ requestId: "request-conflict", lines: [{ productId: "product-a-taxable", quantity: 3 }] }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" } satisfies Partial<V2PocError>);
  });

  test("rolls back order, lines, invoice, audit, and request record when invoice persistence fails", async () => {
    const database = createFixtureDatabase();
    const invoices = new InvoiceRepository();
    invoices.failNextCreate = true;
    const { operation } = createFixtureApplication(database, invoices);
    await expect(operation.execute("owner-a", command({ requestId: "request-rollback" }))).rejects.toMatchObject({ code: "INJECTED_FAILURE" } satisfies Partial<V2PocError>);
    expect(database.snapshot()).toMatchObject({ orders: [], invoices: [], requests: [], auditEvents: [] });
  });

  test("reads an order and invoice back through a second application instance", async () => {
    const database = createFixtureDatabase();
    const created = await createFixtureApplication(database).operation.execute("owner-a", command({ requestId: "request-readback" }));
    const reloaded = await createFixtureApplication(database).readOrder.execute("owner-a", "org-a", created.order.id);
    expect(reloaded.order.lines).toEqual(created.order.lines);
    expect(reloaded.invoice.lines).toEqual(created.invoice.lines);
  });

  test("does not leak a guessed foreign order ID", async () => {
    const database = createFixtureDatabase();
    const created = await createFixtureApplication(database).operation.execute("owner-a", command({ requestId: "request-foreign-order" }));
    await expect(createFixtureApplication(database).readOrder.execute("owner-b", "org-b", created.order.id)).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
  });
});
