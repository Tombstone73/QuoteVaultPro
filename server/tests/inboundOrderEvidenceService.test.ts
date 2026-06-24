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

  test("manual PO classification is authoritative parse evidence", async () => {
    const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
      organizationId: "org_1",
      record: record(),
      files: [inboundFile({ role: "artwork", sourceFilename: "customer-art.pdf", reviewNotes: "Originally artwork." })],
      manualClassifications: new Map([[
        "file:file_1",
        {
          classification: "PO",
          automaticClassification: "ARTWORK",
          automaticConfidence: 91,
          automaticReasons: ["filename contained artwork terms"],
          learningEvidence: {
            inboundRecordId: "inbound_1",
            attachmentKey: "file:file_1",
            originalAutomaticClassification: "ARTWORK",
            correctedManualClassification: "PO",
          },
        },
      ]]),
    });

    const attachment = bundle.items.find((item) => item.sourceId === "file_1");
    expect(bundle.items[0]?.sourceId).toBe("file_1");
    expect(attachment).toEqual(expect.objectContaining({
      documentType: "purchase_order",
      documentConfidence: 100,
      manualClassificationUsed: true,
      automaticClassification: "ARTWORK",
      manualClassification: "PO",
      finalClassification: "PO",
      classificationInfluence: "Manual PO classification used as authoritative purchase-order evidence.",
    }));
    expect(attachment?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "manual_attachment_classification_used" }),
    ]));
  });

  test("manual artwork classification prevents PO parsing and marks artwork evidence", async () => {
    const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
      organizationId: "org_1",
      record: record(),
      files: [inboundFile({ role: "po", sourceFilename: "final-art.pdf", reviewNotes: "Originally PO candidate." })],
      manualClassifications: new Map([[
        "file:file_1",
        {
          classification: "ARTWORK",
          automaticClassification: "PO",
          automaticConfidence: 88,
          automaticReasons: ["filename contained PO"],
          learningEvidence: null,
        },
      ]]),
    });

    const attachment = bundle.items.find((item) => item.sourceId === "file_1");
    expect(attachment).toEqual(expect.objectContaining({
      documentType: "artwork_reference",
      documentConfidence: 100,
      poSummary: null,
      manualClassificationUsed: true,
      manualClassification: "ARTWORK",
    }));
  });

  test("manual junk classification removes attachment from parse evidence", async () => {
    const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
      organizationId: "org_1",
      record: record(),
      files: [inboundFile({ role: "artwork", sourceFilename: "signature-logo.png", mimeType: "image/png" })],
      manualClassifications: new Map([[
        "file:file_1",
        {
          classification: "IGNORE_INLINE",
          automaticClassification: "ARTWORK",
          automaticConfidence: 78,
          automaticReasons: ["image file type"],
          learningEvidence: null,
        },
      ]]),
    });

    expect(bundle.items.some((item) => item.sourceId === "file_1")).toBe(false);
  });
});
