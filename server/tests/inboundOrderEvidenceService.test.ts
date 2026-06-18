import { describe, expect, test } from "@jest/globals";

import { inboundOrderEvidenceService } from "../services/inboundOrders/InboundOrderEvidenceService";
import type { InboundOrderFile, InboundOrderRecord } from "@shared/schema";

function record(): InboundOrderRecord {
  return {
    id: "inbound_1",
    organizationId: "org_1",
    sourceId: null,
    sourceType: "email",
    sourceLabel: "TEMP_INBOUND email intake",
    sourceTrustLevel: "semi_trusted_email",
    sourceRecordId: "gmail_msg_1",
    sourceMessageId: "gmail_msg_1",
    status: "needs_review",
    reviewOutcome: null,
    requiresHumanDecision: true,
    reviewRequiredReason: "Email candidate needs staff review.",
    externalReference: "PO attached",
    idempotencyKey: "gmail:gmail_msg_1",
    payloadHash: null,
    rawPayloadJson: {
      subject: "PO attached",
      bodyText: "Please see attached PO.",
      sender: { email: "buyer@example.com" },
    },
    normalizedPayloadJson: {
      subject: "PO attached",
      bodyText: "Please see attached PO.",
    },
    extractedCustomerJson: {},
    extractedOrderJson: {},
    extractedShippingJson: {},
    confidenceScore: null,
    duplicateScore: null,
    matchedCustomerId: null,
    matchedContactId: null,
    matchedQuoteId: null,
    matchedOrderId: null,
    createdQuoteId: null,
    createdOrderId: null,
    assignedToUserId: null,
    submittedByUserId: null,
    rejectedByUserId: null,
    rejectionReason: null,
    receivedAt: new Date("2026-06-17T12:00:00.000Z"),
    parsedAt: null,
    reviewStartedAt: null,
    approvedAt: null,
    submittedAt: null,
    rejectedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-06-17T12:00:00.000Z"),
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
  };
}

function inboundFile(overrides: Partial<InboundOrderFile> = {}): InboundOrderFile {
  return {
    id: "file_1",
    organizationId: "org_1",
    inboundRecordId: "inbound_1",
    inboundLineItemId: null,
    fileRecordId: null,
    sourceFilename: "Purchase Order 151661.pdf",
    role: "po",
    mimeType: "application/pdf",
    sizeBytes: 12000,
    checksum: null,
    status: "uploaded",
    providerAttachmentId: "att_1",
    providerMessageId: "gmail_msg_1",
    contentDisposition: "attachment",
    metadataJson: { poCandidate: true },
    reviewNotes: "PO candidate, text not extracted.",
    createdQuoteAttachmentId: null,
    createdOrderAttachmentId: null,
    createdAt: new Date("2026-06-17T12:00:00.000Z"),
    updatedAt: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

describe("InboundOrderEvidenceService attachment evidence", () => {
  test("keeps metadata-only PO PDFs visible as PO candidates when text is not extracted", async () => {
    const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
      organizationId: "org_1",
      record: record(),
      files: [inboundFile()],
    });

    const attachment = bundle.items.find((item) => item.sourceId === "file_1");
    expect(attachment).toEqual(expect.objectContaining({
      type: "PDF_ATTACHMENT",
      documentType: "purchase_order",
      documentConfidence: 70,
      extractionStatus: "failed",
      rawText: null,
    }));
    expect(attachment?.warnings?.[0]?.message).toContain("PO candidate PDF was stored");
  });
});
