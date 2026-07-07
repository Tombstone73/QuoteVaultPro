import { describe, expect, jest, test } from "@jest/globals";
import archiver from "archiver";

import {
  extractMachineReadableWordText,
  inboundOrderEvidenceService,
} from "../services/inboundOrders/InboundOrderEvidenceService";
import type { InboundOrderFile, InboundOrderRecord } from "@shared/schema";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function documentXml(text: string): string {
  const paragraphs = text.split(/\r?\n/).map((line) => (
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr/>
  </w:body>
</w:document>`;
}

function createDocxBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, { name: "[Content_Types].xml" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: "_rels/.rels" });
    archive.append(documentXml(text), { name: "word/document.xml" });
    void archive.finalize();
  });
}

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
  test("extracts readable text from Word document buffers", async () => {
    const buffer = await createDocxBuffer([
      "Purchase Order 151900",
      "QTY: 1",
      "Foam Core Sign",
      "Stock: 3/16\" Foam Core",
      "Final Trim: 24 x 36",
    ].join("\n"));

    const extracted = await extractMachineReadableWordText(buffer);

    expect(extracted.text).toContain("Purchase Order 151900");
    expect(extracted.text).toContain("QTY: 1");
    expect(extracted.text).toContain("Final Trim: 24 x 36");
  });

  test("uses Word PO text as parse evidence with field sources", async () => {
    const buffer = await createDocxBuffer([
      "Purchase Order 151900",
      "Arrival Due Date 6/24",
      "QTY: 1",
      "Product: Foam Core Sign",
      "Stock: 3/16\" Foam Core",
      "Final Trim: 24 x 36",
    ].join("\n"));
    const readSpy = jest
      .spyOn(inboundOrderEvidenceService as unknown as { readCanonicalFile(fileRecordId: string): Promise<Buffer | null> }, "readCanonicalFile")
      .mockResolvedValue(buffer);

    try {
      const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
        organizationId: "org_1",
        record: record(),
        files: [inboundFile({
          fileRecordId: "canonical_docx_1",
          sourceFilename: "Purchase Order 151900.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: buffer.length,
          metadataJson: { poCandidate: true },
        })],
      });

      const attachment = bundle.items.find((item) => item.sourceId === "file_1");
      expect(attachment).toEqual(expect.objectContaining({
        type: "TEXT_ATTACHMENT",
        documentType: "purchase_order",
        extractionStatus: "successful",
        rawText: expect.stringContaining("Foam Core Sign"),
        poSummary: expect.objectContaining({
          poNumber: "151900",
          quantity: 1,
          productDescription: "Foam Core Sign",
          material: "3/16\" Foam Core",
          dimensions: "24 x 36",
        }),
      }));
      expect(attachment?.poSummary?.fieldSources.quantity?.sourceType).toBe("TEXT_ATTACHMENT");
      expect(attachment?.poSummary?.fieldSources.dimensions?.sourceText).toContain("Final Trim: 24 x 36");
      expect(bundle.reconciliation?.quantity.value).toBe(1);
      expect(bundle.reconciliation?.dimensions.value).toBe("24 x 36");
      expect(bundle.reconciliation?.material.value).toBe("3/16\" Foam Core");
    } finally {
      readSpy.mockRestore();
    }
  });

  test("keeps ZIP archives visible without extracting or parsing contents", async () => {
    const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
      organizationId: "org_1",
      record: record(),
      files: [inboundFile({
        sourceFilename: "Glass Barn Tractor Signs - 2026[1].zip",
        role: "artwork",
        mimeType: "application/zip",
        status: "quarantined",
        fileRecordId: "canonical_zip_1",
        reviewNotes: "ZIP archive stored for manual review. Contents were not extracted.",
        metadataJson: { attachmentState: "scan_pending", attachmentExtension: "zip" },
      })],
    });

    const attachment = bundle.items.find((item) => item.sourceId === "file_1");
    expect(attachment).toEqual(expect.objectContaining({
      type: "TEXT_ATTACHMENT",
      rawText: null,
      poSummary: null,
      extractionStatus: "not_attempted",
      documentType: "artwork_reference",
    }));
    expect(attachment?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "zip_attachment_quarantined",
        message: expect.stringContaining("Contents were not extracted or parsed"),
      }),
    ]));
    expect(bundle.reconciliation?.product.value).toBeNull();
    expect(bundle.reconciliation?.quantity.value).toBeNull();
    expect(bundle.reconciliation?.dimensions.value).toBeNull();
  });

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

  test("surfaces PO-like reference PDFs as purchase-order evidence without changing stored role", async () => {
    const bundle = await inboundOrderEvidenceService.buildEvidenceBundle({
      organizationId: "org_1",
      record: record(),
      files: [inboundFile({
        role: "reference",
        sourceFilename: "Purchase Order No 151753 Titan Compass ACM Sign.pdf",
        metadataJson: { poCandidate: false },
      })],
    });

    const attachment = bundle.items.find((item) => item.sourceId === "file_1");
    expect(attachment).toEqual(expect.objectContaining({
      type: "PDF_ATTACHMENT",
      documentType: "purchase_order",
      documentConfidence: 62,
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
