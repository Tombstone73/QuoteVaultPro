import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";

let rows: Record<string, any[]>;
let writes: string[];
let failOrderWrite = false;
const query = () => {
  let table = "";
  const q: any = {
    from: (t: any) => { table = getTableName(t); return q; },
    where: () => q,
    limit: async (n: number) => (rows[table] ?? []).slice(0, n),
    then: (resolve: any, reject: any) => Promise.resolve(rows[table] ?? []).then(resolve, reject),
  };
  return q;
};
const tx: any = {
  select: query,
  execute: jest.fn(async () => ({ rows: [] })),
  update: (t: any) => ({ set: (patch: any) => ({ where: async () => {
    const table = getTableName(t); writes.push(table); Object.assign(rows[table][0], patch);
  } }) }),
  insert: () => ({ values: async () => {} }),
};
const database = {
  select: query,
  transaction: async (fn: (handle: any) => any) => {
    const before = structuredClone(rows);
    try { return await fn(tx); } catch (error) { rows = before; throw error; }
  },
};
jest.unstable_mockModule("../db", () => ({ db: database }));
jest.unstable_mockModule("../storage", () => ({ storage: {} }));
jest.unstable_mockModule("../services/orderCustomerResolutionService", () => ({
  resolveOrderCustomerContactIds: async (input: any) => ({ customerId: input.customerId, contactId: input.contactId }),
}));
jest.unstable_mockModule("../services/customerCreditPolicyService", () => ({
  assertCustomerCreditForOrder: async () => ({}), orderPayloadTotalCents: () => 2500,
}));
jest.unstable_mockModule("../storage/orders.repo", () => ({ OrdersRepository: class {
  constructor(handle: any) { expect(handle).toBe(tx); }
  async updateOrder(_org: string, _id: string, patch: any) {
    if (failOrderWrite) throw new Error("order write failed");
    writes.push("orders"); Object.assign(rows.orders[0], patch); return rows.orders[0];
  }
} }));
jest.unstable_mockModule("../services/orders/orderTaxCalculationService", () => ({
  recalculateEditableOrderFinancialsInTransaction: async (handle: any) => { expect(handle).toBe(tx); return rows.orders[0]; },
}));
let operations: typeof import("../services/orders/canonicalOrderOperations").canonicalOrderOperations;
beforeAll(async () => { operations = (await import("../services/orders/canonicalOrderOperations")).canonicalOrderOperations; });
beforeEach(() => {
  rows = {
    orders: [{ id: "order", organizationId: "org", customerId: "company", contactId: "contact", status: "new", total: "25.00" }],
    invoices: [{ id: "invoice", organizationId: "org", customerId: "company", contactId: null, status: "billed", issuedAt: new Date(), amountPaid: "0", invoiceVersion: 1 }],
    audit_logs: [{ id: "automatic-creation" }],
  };
  writes = []; failOrderWrite = false;
});
const save = (changes: any) => operations.updateEditableHeader({ organizationId: "org", actorUserId: "staff", orderId: "order", changes });

describe("canonical contact billing owner transaction (mocked persistence)", () => {
  test("explicit clear retains Contact and retargets the safe automatic Invoice in the same transaction", async () => {
    await save({ customerId: null });
    expect(rows.orders[0]).toMatchObject({ customerId: null, contactId: "contact" });
    expect(rows.invoices[0]).toMatchObject({ customerId: null, contactId: "contact", invoiceVersion: 2 });
    expect(writes).toEqual(["invoices", "orders"]);
  });
  test("omitted Customer preserves Customer-only ownership", async () => {
    await save({ contactId: null });
    expect(rows.orders[0]).toMatchObject({ customerId: "company", contactId: null });
    expect(writes).toEqual(["orders"]);
  });
  test("neither-owner request fails before any write", async () => {
    await expect(save({ customerId: null, contactId: null })).rejects.toThrow("Select a customer or contact");
    expect(writes).toEqual([]);
  });
  test.each(["payments", "invoice_email_logs", "invoice_email_delivery_jobs", "customer_payment_batches"])("blocks %s evidence without changing either owner", async table => {
    rows[table] = [{ id: "history" }];
    await expect(save({ customerId: null })).rejects.toThrow(/Invoice|payment/);
    expect(writes).toEqual([]);
    expect(rows.invoices[0].customerId).toBe("company");
  });
  test.each(["accountingApprovedAt", "qbInvoiceId", "importedAt", "lastSentAt"])("blocks immutable %s", async field => {
    rows.invoices[0][field] = "history";
    await expect(save({ customerId: null })).rejects.toThrow(/Invoice/);
    expect(writes).toEqual([]);
  });
  test("an Order write failure rolls back the Invoice update through the transaction boundary", async () => {
    failOrderWrite = true;
    await expect(save({ customerId: null })).rejects.toThrow("order write failed");
    expect(rows.invoices[0]).toMatchObject({ customerId: "company", contactId: null, invoiceVersion: 1 });
  });
});
