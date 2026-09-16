import { describe, expect, test } from "@jest/globals";
import { buildCustomerCreditExposure, classifyCustomerExposureInvoice } from "../customerCreditExposure";

const invoice = (overrides: Record<string, unknown> = {}) => ({
  status: "billed",
  approvedForAccounting: true,
  remainingCents: 1_000,
  creditCents: 0,
  displayStatus: "Unpaid",
  ...overrides,
});

describe("customer credit exposure classification", () => {
  test("places an approved unpaid invoice in A/R only", () => {
    expect(buildCustomerCreditExposure(null, [invoice()])).toMatchObject({ outstandingArCents: 1_000, pendingBillingCents: 0, creditExposureCents: 1_000 });
  });

  test.each([
    ["not approved", invoice({ approvedForAccounting: false })],
    ["needs reapproval", invoice({ approvedForAccounting: false, status: "billed" })],
    ["sent through override", invoice({ approvedForAccounting: false, sendStatus: "sent" })],
    ["partially paid before approval", invoice({ approvedForAccounting: false, remainingCents: 750, displayStatus: "Partially Paid" })],
  ])("places %s positive balance in pending billing only", (_label, row) => {
    expect(buildCustomerCreditExposure(null, [row])).toMatchObject({ outstandingArCents: 0, pendingBillingCents: row.remainingCents, creditExposureCents: row.remainingCents });
  });

  test.each([
    ["fully paid", invoice({ status: "paid", remainingCents: 0, displayStatus: "Paid" })],
    ["void", invoice({ status: "void", remainingCents: 1_000 })],
    ["credit/refund due", invoice({ status: "credit", remainingCents: 1_000, creditCents: 100, displayStatus: "Credit / Refund Due" })],
    ["paid historical", invoice({ status: "billed", remainingCents: 0, displayStatus: "Paid Historical" })],
  ])("excludes %s from positive exposure", (_label, row) => {
    expect(classifyCustomerExposureInvoice(row)).toBeNull();
    expect(buildCustomerCreditExposure(null, [row]).creditExposureCents).toBe(0);
  });

  test("keeps an approved never-sent partial balance in A/R", () => {
    expect(buildCustomerCreditExposure(null, [invoice({ remainingCents: 600, displayStatus: "Partially Paid", sendStatus: "never_sent" })])).toMatchObject({ outstandingArCents: 600, pendingBillingCents: 0, creditExposureCents: 600 });
  });

  test("moves the same invoice from pending billing to A/R without changing credit exposure", () => {
    const pending = buildCustomerCreditExposure(null, [invoice({ approvedForAccounting: false })]);
    const approved = buildCustomerCreditExposure(null, [invoice({ approvedForAccounting: true })]);
    expect(pending).toMatchObject({ outstandingArCents: 0, pendingBillingCents: 1_000, creditExposureCents: 1_000 });
    expect(approved).toMatchObject({ outstandingArCents: 1_000, pendingBillingCents: 0, creditExposureCents: 1_000 });
  });

  test("reduces exposure when an approved invoice is paid", () => {
    const before = buildCustomerCreditExposure(null, [invoice({ remainingCents: 1_000 })]);
    const after = buildCustomerCreditExposure(null, [invoice({ remainingCents: 600, displayStatus: "Partially Paid" })]);
    expect(before.creditExposureCents - after.creditExposureCents).toBe(400);
  });

  test("puts an active unbilled order into pending billing while keeping open work informational", () => {
    const exposure = buildCustomerCreditExposure(null, [], { unbilledOpenOrdersCents: 2_500, openWorkCents: 9_000 });
    expect(exposure).toMatchObject({ pendingBillingCents: 2_500, creditExposureCents: 2_500, openWorkCents: 9_000 });
  });

  test("does not double count an order once its invoice is represented", () => {
    const exposure = buildCustomerCreditExposure(null, [invoice({ remainingCents: 2_500 })], { unbilledOpenOrdersCents: 0 });
    expect(exposure).toMatchObject({ outstandingArCents: 2_500, pendingBillingCents: 0, creditExposureCents: 2_500 });
  });

  test("classifies multiple invoices for one order independently and reconciles exposure", () => {
    const exposure = buildCustomerCreditExposure(null, [invoice({ remainingCents: 300, approvedForAccounting: true }), invoice({ remainingCents: 200, approvedForAccounting: false })], { openWorkCents: 5_000 });
    expect(exposure).toMatchObject({ outstandingArCents: 300, pendingBillingCents: 200, creditExposureCents: 500, openWorkCents: 5_000 });
    expect(exposure.creditExposureCents).toBe(exposure.outstandingArCents + exposure.pendingBillingCents);
  });
});
