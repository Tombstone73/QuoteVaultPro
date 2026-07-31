import { describe, expect, test } from "@jest/globals";

import { buildInboundQuoteCreatedAuditLogValues } from "../services/inboundOrders/inboundQuoteProvenance";

describe("inbound quote provenance audit contract", () => {
  test("builds a canonical compact quote-created-from-inbound audit row", () => {
    const values = buildInboundQuoteCreatedAuditLogValues({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      quote: { id: "quote_1", displayNumber: "Q-1001", quoteNumber: 1001 },
      record: { sourceType: "email", externalReference: "gmail-message-1" },
      snapshotId: "snapshot_1",
      snapshotVersion: 3,
      createdLineItemCount: 2,
      skippedLineItemCount: 1,
    });

    expect(values).toMatchObject({
      organizationId: "org_1",
      userId: "user_1",
      actionType: "quote_created_from_inbound",
      entityType: "quote",
      entityId: "quote_1",
      entityName: "Q-1001",
      description: "Quote draft created from inbound review.",
      newValues: {
        inboundRecordId: "inbound_1",
        inboundDraftId: "inbound_1",
        sourceType: "email",
        sourceReference: "gmail-message-1",
        resultingQuoteId: "quote_1",
        resultingQuoteNumber: 1001,
        snapshotId: "snapshot_1",
        snapshotVersion: 3,
        convertedLineItemCount: 2,
        skippedLineItemCount: 1,
      },
    });
    expect(JSON.stringify(values)).not.toContain("bodyText");
    expect(JSON.stringify(values)).not.toContain("rawPayloadJson");
  });
});
