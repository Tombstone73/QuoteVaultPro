import { describe, expect, jest, test } from "@jest/globals";

import {
  allocateDocumentNumber,
  allocateJobNumber,
  isDocumentNumberUniqueViolation,
} from "../services/documentNumberingService";

function makeExecutor(prefix: string, allocatedCore: number) {
  const execute = jest.fn(async () => ({ rows: [{ number_core: allocatedCore }] }));
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

  test("allocates a shared Job Number without a document-type prefix", async () => {
    const executor = makeExecutor("unused", 0);
    executor.execute.mockResolvedValue({ rows: [{ job_number: 20342 }] });

    await expect(allocateJobNumber("org_1", executor)).resolves.toBe(20342);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(String(executor.execute.mock.calls[0]?.[0]?.queryChunks ?? executor.execute.mock.calls[0]?.[0])).toContain("next_job_number");
  });

  test("keeps concurrent tenant allocations distinct when PostgreSQL returns distinct atomic increments", async () => {
    const executor = makeExecutor("unused", 0);
    executor.execute
      .mockResolvedValueOnce({ rows: [{ job_number: 20342 }] })
      .mockResolvedValueOnce({ rows: [{ job_number: 20343 }] });

    const allocated = await Promise.all([
      allocateJobNumber("org_1", executor),
      allocateJobNumber("org_1", executor),
    ]);

    expect(new Set(allocated)).toEqual(new Set([20342, 20343]));
  });

  test("fails closed when the shared counter is malformed or exhausted instead of recycling a lower number", async () => {
    const executor = makeExecutor("unused", 0);
    executor.execute.mockResolvedValue({ rows: [] });

    await expect(allocateJobNumber("org_1", executor)).rejects.toThrow("invalid or exhausted");
    expect(String(executor.execute.mock.calls[0]?.[0]?.queryChunks ?? executor.execute.mock.calls[0]?.[0])).toContain("2147483647");
  });

  test("identifies document-number unique violations as safe conflicts", () => {
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "orders_org_display_number_unique" })).toBe(true);
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "quotes_org_number_core_unique" })).toBe(true);
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "purchase_orders_org_po_number_unique" })).toBe(true);
    expect(isDocumentNumberUniqueViolation({ code: "23505", constraint: "users_email_unique" })).toBe(false);
  });
});
