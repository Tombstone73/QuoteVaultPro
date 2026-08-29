import { describe, expect, jest, test } from "@jest/globals";

import {
  allocateDocumentNumber,
  isDocumentNumberUniqueViolation,
} from "../services/documentNumberingService";

function makeExecutor(prefix: string, allocatedCore: number) {
  const execute = jest.fn(async () => ({ rows: [{ number_core: allocatedCore, display_prefix: prefix }] }));
  const prefixRows = [{ value: prefix }];
  const chain: any = {
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve(prefixRows)),
  };
  return {
    execute,
    select: jest.fn(() => chain),
  };
}

describe("documentNumberingService", () => {
  test("allocates a prefixed document number from one atomic database statement", async () => {
    const executor = makeExecutor("ORD-", 1006);

    const allocated = await allocateDocumentNumber("org_1", "order", executor);

    expect(allocated).toEqual({ numberCore: 1006, displayNumber: "ORD-1006" });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.select).not.toHaveBeenCalled();
  });

  test("routes compatibility Quote and Order writers through the shared V2 allocator", async () => {
    const executor = makeExecutor("QT-", 20016);

    await expect(allocateDocumentNumber("org_1", "quote", executor)).resolves.toEqual({
      numberCore: 20016,
      displayNumber: "QT-20016",
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.select).not.toHaveBeenCalled();
  });

  test("supports blank prefixes while preserving searchable numeric core", async () => {
    const executor = makeExecutor("", 1006);

    const allocated = await allocateDocumentNumber("org_1", "invoice", executor);

    expect(allocated).toEqual({ numberCore: 1006, displayNumber: "1006" });
  });

  test("allocates internal purchase order numbers through the shared atomic service", async () => {
    const executor = makeExecutor("PO-", 20000);

    const allocated = await allocateDocumentNumber("org_1", "purchase_order", executor);

    expect(allocated).toEqual({ numberCore: 20000, displayNumber: "PO-20000" });
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  test("identifies document-number unique violations as safe conflicts", () => {
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "orders_org_display_number_unique" })).toBe(true);
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "quotes_org_number_core_unique" })).toBe(true);
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "purchase_orders_org_po_number_unique" })).toBe(true);
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "users_email_unique" })).toBe(false);
  });
});
