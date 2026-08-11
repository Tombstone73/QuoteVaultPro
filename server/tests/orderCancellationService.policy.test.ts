import { describe, expect, test } from "@jest/globals";

import {
  classifyCombinedRunForOrderCancellation,
  classifyInvoiceForCancellation,
  classifyShipmentForCancellation,
} from "../services/orderCancellationService";
import {
  isCanceledOrder,
  isOperationallyActiveProductionJob,
  isTerminalProductionStatus,
} from "../../shared/operationalState";

describe("order cancellation policy helpers", () => {
  test.each([
    ["draft", "draft_invoice"],
    ["billed", "unpaid_invoice"],
    ["sent", "unpaid_invoice"],
    ["overdue", "unpaid_invoice"],
  ])("voids unpaid %s invoices", (status, reason) => {
    expect(classifyInvoiceForCancellation({ id: "inv-1", status, amountPaid: "0" })).toEqual({
      action: "void",
      invoiceId: "inv-1",
      status,
      reason,
    });
  });

  test("blocks paid invoices", () => {
    expect(classifyInvoiceForCancellation({ id: "inv-paid", status: "paid", amountPaid: "100.00" })).toMatchObject({
      action: "block",
      invoiceId: "inv-paid",
      code: "PAID_INVOICE",
    });
  });

  test("blocks partially paid invoices by status, amount paid, or successful payments", () => {
    expect(classifyInvoiceForCancellation({ id: "inv-partial", status: "partially_paid", amountPaid: "0" })).toMatchObject({
      action: "block",
      code: "PARTIALLY_PAID_INVOICE",
    });
    expect(classifyInvoiceForCancellation({ id: "inv-amount", status: "billed", amountPaid: "1.00" })).toMatchObject({
      action: "block",
      code: "PARTIALLY_PAID_INVOICE",
    });
    expect(classifyInvoiceForCancellation({ id: "inv-payment", status: "draft", amountPaid: "0" }, 1)).toMatchObject({
      action: "block",
      code: "PARTIALLY_PAID_INVOICE",
    });
  });

  test("voids draft shipments and blocks shipped shipments", () => {
    expect(classifyShipmentForCancellation({ id: "ship-draft", status: "DRAFT" })).toEqual({
      action: "void",
      shipmentId: "ship-draft",
      status: "DRAFT",
      reason: "pending_shipment",
    });
    expect(classifyShipmentForCancellation({ id: "ship-shipped", status: "SHIPPED" })).toMatchObject({
      action: "block",
      code: "SHIPPED_SHIPMENT",
    });
  });

  test("blocks unfinished active Combined Run members before order cancellation side effects", () => {
    expect(classifyCombinedRunForOrderCancellation({
      productionJobId: "job-1",
      productionRunId: "run-1",
      runNumber: 42,
      runStatus: "in_production",
      allocatedQuantity: 10,
      completedQuantity: 4,
      damagedQuantity: 1,
      remainingQuantity: 5,
    })).toMatchObject({
      action: "block",
      code: "COMBINED_RUN_ACTIVE",
      productionJobId: "job-1",
      productionRunId: "run-1",
      runNumber: 42,
      runStatus: "in_production",
    });
  });

  test("allows historical or fully reconciled Combined Run members", () => {
    expect(classifyCombinedRunForOrderCancellation({
      productionJobId: "job-complete",
      productionRunId: "run-complete",
      runStatus: "completed",
      allocatedQuantity: 10,
      completedQuantity: 5,
      damagedQuantity: 0,
      remainingQuantity: 5,
    })).toMatchObject({
      action: "allow",
      reason: "run_inactive_or_finished",
    });

    expect(classifyCombinedRunForOrderCancellation({
      productionJobId: "job-reconciled",
      productionRunId: "run-reconciled",
      runStatus: "ready_for_production",
      allocatedQuantity: 10,
      completedQuantity: 8,
      damagedQuantity: 2,
      remainingQuantity: 0,
    })).toMatchObject({
      action: "allow",
      reason: "run_inactive_or_finished",
    });
  });

  test("central operational state helpers treat cancelled work as terminal", () => {
    expect(isCanceledOrder({ state: "canceled", status: "in_production" })).toBe(true);
    expect(isCanceledOrder({ state: "open", status: "cancelled" })).toBe(true);
    expect(isCanceledOrder({ state: "open", status: "in_production", canceledAt: new Date() })).toBe(true);
    expect(isTerminalProductionStatus("canceled")).toBe(true);
    expect(isOperationallyActiveProductionJob({ status: "canceled" })).toBe(false);
    expect(isOperationallyActiveProductionJob({ status: "queued" })).toBe(true);
  });
});
