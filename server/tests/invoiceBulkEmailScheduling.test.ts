import { describe, expect, test } from "@jest/globals";
import { getNextBulkInvoiceEmailSlot } from "../services/invoiceBulkEmailScheduling";

const at = (value: string) => new Date(value);

describe("bulk invoice email scheduling", () => {
  test("uses the current time for the first job and 60-second slots for the remaining batch", () => {
    const first = getNextBulkInvoiceEmailSlot({ now: at("2026-09-04T16:00:00.000Z"), latestScheduledAt: null, spacingSeconds: 60 });
    const second = getNextBulkInvoiceEmailSlot({ now: first, latestScheduledAt: first, spacingSeconds: 60 });
    const third = getNextBulkInvoiceEmailSlot({ now: second, latestScheduledAt: second, spacingSeconds: 60 });
    expect(first.toISOString()).toBe("2026-09-04T16:00:00.000Z");
    expect(second.getTime() - first.getTime()).toBe(60_000);
    expect(third.getTime() - second.getTime()).toBe(60_000);
  });

  test("appends a new batch after existing scheduled work", () => {
    expect(getNextBulkInvoiceEmailSlot({
      now: at("2026-09-04T15:59:00.000Z"),
      latestScheduledAt: at("2026-09-04T16:02:00.000Z"),
      spacingSeconds: 60,
    }).toISOString()).toBe("2026-09-04T16:03:00.000Z");
  });

  test("keeps sender schedules isolated by organization input", () => {
    const tenantA = getNextBulkInvoiceEmailSlot({ now: at("2026-09-04T16:00:00.000Z"), latestScheduledAt: at("2026-09-04T16:05:00.000Z"), spacingSeconds: 60 });
    const tenantB = getNextBulkInvoiceEmailSlot({ now: at("2026-09-04T16:00:00.000Z"), latestScheduledAt: null, spacingSeconds: 60 });
    expect(tenantA.toISOString()).toBe("2026-09-04T16:06:00.000Z");
    expect(tenantB.toISOString()).toBe("2026-09-04T16:00:00.000Z");
  });
});
