import { describe, expect, test } from "@jest/globals";
import { resolveFulfillmentLineQuantity } from "@shared/fulfillmentReadiness";
import { isProvenLegacyCloseJobOverrideEvidence } from "../services/fulfillment/legacyCloseJobOverrideEvidence";

const provenEvidence = {
  event: {
    eventType: "FULFILLMENT_HISTORICAL_RECONCILED",
    payloadJson: {
      source: "administrative_historical_reconciliation",
      shipmentOrPickupEvidenceCreated: false,
      billingAutomationSuppressed: true,
    },
  },
  audit: { actionType: "ORDER_HISTORICAL_FULFILLMENT_RECONCILED", entityType: "order" },
};

describe("legacy Close Job Override evidence", () => {
  test("detects the durable paired evidence written before 0212", () => {
    expect(isProvenLegacyCloseJobOverrideEvidence(provenEvidence)).toBe(true);
  });

  test("does not infer an administrative close from a terminal parent or a partial record", () => {
    expect(isProvenLegacyCloseJobOverrideEvidence({ event: provenEvidence.event, audit: null })).toBe(false);
    expect(isProvenLegacyCloseJobOverrideEvidence({
      event: { ...provenEvidence.event, payloadJson: { source: "administrative_historical_reconciliation" } },
      audit: provenEvidence.audit,
    })).toBe(false);
  });

  test("a legacy allocation closes only the current remainder and stays physically truthful on replay", () => {
    const before = resolveFulfillmentLineQuantity({ workflowIntent: "fulfillment_only", orderedQuantity: 10, shippedQuantity: 4 });
    const after = resolveFulfillmentLineQuantity({
      workflowIntent: "fulfillment_only", orderedQuantity: 10, shippedQuantity: 4,
      administrativelyReconciledQuantity: before.remainingQuantity,
    });
    const replay = resolveFulfillmentLineQuantity({
      workflowIntent: "fulfillment_only", orderedQuantity: 10, shippedQuantity: 4,
      administrativelyReconciledQuantity: after.administrativelyReconciledQuantity + after.remainingQuantity,
    });
    expect(after).toMatchObject({ shippedQuantity: 4, administrativelyReconciledQuantity: 6, remainingQuantity: 0 });
    expect(replay).toMatchObject({ shippedQuantity: 4, administrativelyReconciledQuantity: 6, remainingQuantity: 0 });
  });
});
