import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const existingOrder = {
  id: "order-1",
  organizationId: "org-1",
  customerId: "customer-1",
  contactId: "contact-1",
  orderNumber: "ORD-20139",
  displayNumber: "ORD-20139",
  status: "in_production",
  total: "125.50",
  updatedAt: new Date("2026-08-20T12:00:00.000Z"),
};

const assertCustomerCreditForOrder = jest.fn<(...args: any[]) => Promise<any>>();
const resolveOrderCustomerContactIds = jest.fn<(...args: any[]) => Promise<any>>();
const synchronizeOrderBackedInvoiceFromOrderInTransaction = jest.fn<(...args: any[]) => Promise<any>>();
const updateOrder = jest.fn<(...args: any[]) => Promise<any>>();
const auditValues = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("@shared/schema", () => ({ auditLogs: {}, orders: {} }));
jest.unstable_mockModule("drizzle-orm", () => ({ and: jest.fn(), eq: jest.fn() }));
jest.unstable_mockModule("../db", () => ({
  db: {
    select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [existingOrder] }) }) })),
    insert: jest.fn(() => ({ values: auditValues })),
  },
}));
jest.unstable_mockModule("../storage", () => ({ storage: { updateOrder } }));
jest.unstable_mockModule("../services/orderCustomerResolutionService", () => ({ resolveOrderCustomerContactIds }));
jest.unstable_mockModule("../services/customerCreditPolicyService", () => ({
  assertCustomerCreditForOrder,
  orderPayloadTotalCents: jest.fn(),
}));
jest.unstable_mockModule("../invoicesService", () => ({ synchronizeOrderBackedInvoiceFromOrderInTransaction }));
jest.unstable_mockModule("@shared/customerCreditExposure", () => ({
  parseMoneyToCents: (value: unknown) => Math.round(Number(value) * 100),
}));

let canonicalOrderOperations: typeof import("../services/orders/canonicalOrderOperations").canonicalOrderOperations;

beforeAll(async () => {
  ({ canonicalOrderOperations } = await import("../services/orders/canonicalOrderOperations"));
});

beforeEach(() => {
  jest.clearAllMocks();
  assertCustomerCreditForOrder.mockResolvedValue(null);
  resolveOrderCustomerContactIds.mockResolvedValue({ customerId: "customer-2", contactId: "contact-2" });
  updateOrder.mockImplementation(async (_organizationId, _orderId, changes) => ({ ...existingOrder, ...changes }));
  auditValues.mockResolvedValue(undefined);
});

describe("canonical editable Order header updates", () => {
  test.each([
    ["PO only", { poNumber: "PO-20139" }],
    ["due date only", { dueDate: "2026-08-21T12:00:00.000Z" }],
    ["PO and due date", { poNumber: "PO-20139", dueDate: "2026-08-21T12:00:00.000Z" }],
  ])("updates an in-production Order for %s without invoice synchronization", async (_name, changes) => {
    await expect(canonicalOrderOperations.updateEditableHeader({
      organizationId: "org-1",
      actorUserId: "user-1",
      orderId: "order-1",
      allowNonNew: true,
      changes: changes as any,
    })).resolves.toMatchObject(changes);

    expect(assertCustomerCreditForOrder).toHaveBeenCalledWith(expect.objectContaining({
      proposedOrderTotalCents: 12_550,
      existingOrderTotalCents: 12_550,
    }));
    expect(updateOrder).toHaveBeenCalledWith("org-1", "order-1", changes);
    expect(synchronizeOrderBackedInvoiceFromOrderInTransaction).not.toHaveBeenCalled();
  });

  test("checks credit before writing and preserves the write boundary when credit rejects", async () => {
    const rejection = new Error("credit limit exceeded");
    assertCustomerCreditForOrder.mockRejectedValueOnce(rejection);

    await expect(canonicalOrderOperations.updateEditableHeader({
      organizationId: "org-1",
      actorUserId: "user-1",
      orderId: "order-1",
      allowNonNew: true,
      changes: { poNumber: "PO-20139" } as any,
    })).rejects.toThrow("credit limit exceeded");

    expect(updateOrder).not.toHaveBeenCalled();
  });

  test("uses the new financial total and resolved customer for credit enforcement", async () => {
    await canonicalOrderOperations.updateEditableHeader({
      organizationId: "org-1",
      actorUserId: "user-1",
      orderId: "order-1",
      allowNonNew: true,
      changes: { customerId: "customer-2", total: "240.00" } as any,
    });

    expect(assertCustomerCreditForOrder).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-2",
      proposedOrderTotalCents: 24_000,
      existingOrderTotalCents: 0,
    }));
    expect(synchronizeOrderBackedInvoiceFromOrderInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: "order-1" }));
  });
});
