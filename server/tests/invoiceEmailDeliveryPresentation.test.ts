import { describe, expect, test } from "@jest/globals";
import { resolveCurrentInvoiceEmailDeliveryState, type InvoiceEmailDeliveryState } from "../services/invoiceEmailDeliveryPresentation";

const queueState = (status: InvoiceEmailDeliveryState["status"], updatedAt: string): InvoiceEmailDeliveryState => ({
  id: `job-${status}`,
  status,
  failureReason: status === "failed" || status === "needs_review" ? "Provider result could not be confirmed" : null,
  updatedAt,
});

describe("current invoice delivery presentation", () => {
  test("keeps a queue failure current when there is no later success", () => {
    expect(resolveCurrentInvoiceEmailDeliveryState({ queueState: queueState("failed", "2026-09-04T10:00:00.000Z"), lastSuccessfulDeliveryAt: null })?.status).toBe("failed");
  });

  test("keeps Needs Review current when there is no later success", () => {
    expect(resolveCurrentInvoiceEmailDeliveryState({ queueState: queueState("needs_review", "2026-09-04T10:00:00.000Z"), lastSuccessfulDeliveryAt: null })?.status).toBe("needs_review");
  });

  test("suppresses an older failed or Needs Review queue record after a direct successful send", () => {
    for (const status of ["failed", "needs_review"] as const) {
      expect(resolveCurrentInvoiceEmailDeliveryState({
        queueState: queueState(status, "2026-09-04T10:00:00.000Z"),
        lastSuccessfulDeliveryAt: "2026-09-04T11:00:00.000Z",
      })).toBeNull();
    }
  });

  test("keeps a later failed or active queue state current after an earlier successful send", () => {
    for (const status of ["failed", "queued", "processing", "retrying"] as const) {
      expect(resolveCurrentInvoiceEmailDeliveryState({
        queueState: queueState(status, "2026-09-04T11:00:00.000Z"),
        lastSuccessfulDeliveryAt: "2026-09-04T10:00:00.000Z",
      })?.status).toBe(status);
    }
  });

  test("keeps a sent queue record current while Last Sent remains supplied by the successful log", () => {
    expect(resolveCurrentInvoiceEmailDeliveryState({
      queueState: queueState("sent", "2026-09-04T11:00:01.000Z"),
      lastSuccessfulDeliveryAt: "2026-09-04T11:00:00.000Z",
    })?.status).toBe("sent");
  });
});
