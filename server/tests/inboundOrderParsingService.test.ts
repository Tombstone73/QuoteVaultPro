import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { AiProviderUnavailableError, type AiProviderAdapter } from "../services/ai/providers/AiProviderAdapter";
import { InboundOrderParsingService } from "../services/inboundOrders/InboundOrderParsingService";
import { InboundOrderTransitionError } from "../services/inboundOrders/InboundOrderService";
import {
  classifyDateSourceText,
  detectAttachmentDocument,
  detectEvidenceConflicts,
  extractClassifiedDates,
  extractMachineReadablePdfText,
  extractPurchaseOrderFields,
  type InboundOrderEvidenceBundle,
} from "../services/inboundOrders/InboundOrderEvidenceService";
import { inferInboundRequestedDate } from "../services/inboundOrders/inboundOrderDateInference";
import { scoreProductKnowledgeCandidates } from "../storage/inboundProductKnowledgeMatcher";

function inboundRecord(overrides: Record<string, any> = {}) {
  const now = new Date("2026-06-09T12:00:00.000Z");
  return {
    id: "inbound_1",
    organizationId: "org_1",
    sourceId: null,
    sourceType: "manual",
    sourceLabel: "TEMP_INBOUND manual intake",
    sourceTrustLevel: "manual_internal",
    sourceRecordId: null,
    sourceMessageId: null,
    status: "needs_review",
    reviewOutcome: null,
    requiresHumanDecision: true,
    reviewRequiredReason: "Manual TEMP_INBOUND record needs staff review.",
    externalReference: "PO-123",
    idempotencyKey: null,
    payloadHash: null,
    rawPayloadJson: {
      intakeMode: "TEMP_INBOUND",
      reference: "PO-123",
      sender: { name: "Ada Lovelace", email: "ada@example.com" },
      subject: "Need banners",
      bodyText: "Please make two banners.",
      notes: "Counter intake",
    },
    normalizedPayloadJson: {},
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
    receivedAt: now,
    parsedAt: null,
    reviewStartedAt: null,
    approvedAt: null,
    submittedAt: null,
    rejectedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function parsedDraft(overrides: Record<string, any> = {}) {
  return {
    customer: {
      sourceName: "Ada Lovelace",
      sourceEmail: "ada@example.com",
      sourcePhone: null,
      companyName: "Ada Signs",
      candidateCustomerIds: [],
      candidateContactIds: [],
      customerCandidates: [],
      contactCandidates: [],
      confidence: 90,
      warnings: [],
    },
    order: {
      requestedDueDate: null,
      requestedShipMethod: null,
      requestedPickup: null,
      poNumber: "PO-123",
      notes: "Please make two banners.",
      confidence: 80,
      warnings: [],
    },
    lineItems: [{
      sourceText: "two banners",
      productName: "Banner",
      candidateProductIds: [],
      productCandidates: [],
      quantity: 2,
      width: null,
      height: null,
      dimensionsUnit: null,
      materialText: "vinyl",
      optionTexts: [],
      finishingTexts: [],
      artworkRefs: [],
      confidence: 76,
      warnings: [],
    }],
    artwork: [],
    globalWarnings: [],
    missingDecisions: [],
    ...overrides,
  };
}

function makeRepository(record = inboundRecord()) {
  let currentRecord = { ...record };
  const attempts: any[] = [];
  let eventCounter = 0;
  const repo = {
    getRecord: jest.fn(async () => currentRecord),
    listFiles: jest.fn(async () => []),
    updateRecordWithEvent: jest.fn(async (args: any) => {
      currentRecord = {
        ...currentRecord,
        ...args.patch,
        updatedAt: new Date("2026-06-09T12:02:00.000Z"),
      };
      eventCounter += 1;
      return { record: currentRecord, event: { id: `event_${eventCounter}` } };
    }),
    createParseAttempt: jest.fn(async (values: any) => {
      const attempt = {
        id: `attempt_${attempts.length + 1}`,
        ...values,
        createdAt: new Date("2026-06-09T12:01:00.000Z"),
      };
      attempts.unshift(attempt);
      return attempt;
    }),
    getLatestParseAttempt: jest.fn(async () => attempts[0] ?? null),
    listParseAttempts: jest.fn(async () => attempts),
    searchCustomerCandidates: jest.fn(async () => [{
      id: "customer_1",
      label: "Ada Signs",
      confidence: 88,
      reason: "Matched sender",
      metadata: {},
    }]),
    searchContactCandidates: jest.fn(async () => [{
      id: "contact_1",
      label: "Ada Lovelace",
      confidence: 91,
      reason: "Matched email",
      metadata: {},
    }]),
    searchProductCandidates: jest.fn(async () => [{
      id: "product_1",
      label: "Vinyl Banner",
      confidence: 78,
      reason: "Matched product name",
      metadata: {},
    }]),
    createQuoteDraftFromInboundReview: jest.fn(),
    matchCustomerWithEvent: jest.fn(),
    matchLineItemProductWithEvent: jest.fn(),
  };
  return { repo, attempts, getCurrentRecord: () => currentRecord };
}

function makeProvider(rawText: string): AiProviderAdapter {
  return {
    generateJson: jest.fn(async () => ({
      rawText,
      provider: "test",
      model: "test-model",
      requestMetadata: {},
    })),
    generateBugReview: jest.fn(),
    generateTriageBrief: jest.fn(),
  } as any;
}

describe("InboundOrderParsingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("stores a successful parse attempt with candidates without creating downstream records", async () => {
    const { repo, attempts } = makeRepository();
    const provider = makeProvider(JSON.stringify(parsedDraft()));
    const service = new InboundOrderParsingService(repo as any, () => provider);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.latestAttempt.status).toBe("success");
    expect(result.draft?.customer.customerCandidates[0].id).toBe("customer_1");
    expect(result.draft?.lineItems[0].productCandidates[0].id).toBe("product_1");
    expect(repo.searchProductCandidates).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: "two banners",
      productName: "Banner",
      materialText: "vinyl",
      optionTexts: [],
      finishingTexts: [],
    }));
    expect(attempts[0].parsedDraft.customer.candidateCustomerIds).toEqual(["customer_1"]);
    expect(repo.createParseAttempt).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      inboundOrderRecordId: "inbound_1",
      status: "success",
    }));
    expect(repo.searchCustomerCandidates).toHaveBeenCalled();
    expect(repo.searchContactCandidates).toHaveBeenCalled();
    expect(repo.searchProductCandidates).toHaveBeenCalled();
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
    expect(repo.matchCustomerWithEvent).not.toHaveBeenCalled();
    expect(repo.matchLineItemProductWithEvent).not.toHaveBeenCalled();
  });

  test("stores a failed attempt when the provider is unavailable and preserves source evidence", async () => {
    const { repo, getCurrentRecord } = makeRepository();
    const provider = {
      generateJson: jest.fn(async () => {
        throw new AiProviderUnavailableError("AI provider is not configured.");
      }),
    } as any;
    const service = new InboundOrderParsingService(repo as any, () => provider);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.latestAttempt.status).toBe("failed");
    expect(result.draft).toBeNull();
    expect(result.latestAttempt.errors[0].code).toBe("provider_unavailable");
    expect(getCurrentRecord().rawPayloadJson.bodyText).toBe("Please make two banners.");
    expect(getCurrentRecord().parsedAt).toBeNull();
    expect(repo.createParseAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      parsedDraft: null,
    }));
  });

  test("returns the latest parsed draft preview", async () => {
    const { repo } = makeRepository();
    const draft = parsedDraft();
    await repo.createParseAttempt({
      organizationId: "org_1",
      inboundOrderRecordId: "inbound_1",
      status: "success",
      provider: "test",
      model: "test-model",
      rawPromptHash: "hash",
      rawResponse: {},
      repairedResponse: null,
      parsedDraft: draft,
      confidence: 80,
      warnings: [],
      errors: [],
    });
    const service = new InboundOrderParsingService(repo as any, () => null);

    const preview = await service.getDraftPreview({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
    });

    expect(preview.draft?.order.poNumber).toBe("PO-123");
    expect(preview.latestAttempt?.status).toBe("success");
  });

  test("blocks converted and rejected inbound records", async () => {
    const converted = new InboundOrderParsingService(makeRepository(inboundRecord({ createdOrderId: "order_1" })).repo as any, () => null);
    await expect(converted.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toThrow("Converted inbound records cannot be parsed");

    const rejected = new InboundOrderParsingService(makeRepository(inboundRecord({ status: "terminal" })).repo as any, () => null);
    await expect(rejected.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toThrow("Rejected inbound records cannot be parsed");
  });

  test("returns safe not found errors", async () => {
    const { repo } = makeRepository();
    repo.getRecord.mockResolvedValueOnce(null as any);
    const service = new InboundOrderParsingService(repo as any, () => null);

    await expect(service.getDraftPreview({
      organizationId: "org_1",
      inboundRecordId: "missing",
    })).rejects.toMatchObject({
      message: "Inbound order record not found",
      statusCode: 404,
    });
  });

  test("infers month/day dates from inbound received date context", () => {
    const result = inferInboundRequestedDate({
      text: "ALL FIRM IN HAND BY 6/19",
      receivedAt: "2026-06-08T14:00:00.000Z",
      now: new Date("2026-06-09T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      parsedDate: "2026-06-19",
      sourceText: expect.stringContaining("6/19"),
    });
    expect(result?.confidence).toBeGreaterThanOrEqual(80);
  });

  test("moves ambiguous already-passed month/day dates into the future with warning", () => {
    const result = inferInboundRequestedDate({
      text: "Need by 6/1",
      receivedAt: "2026-06-08T14:00:00.000Z",
      now: new Date("2026-06-09T12:00:00.000Z"),
    });

    expect(result?.parsedDate).toBe("2027-06-01");
    expect(result?.warning).toContain("next year");
  });

  test("infers relative weekday dates from received date context", () => {
    const friday = inferInboundRequestedDate({
      text: "Need by Friday",
      receivedAt: "2026-06-08T14:00:00.000Z",
    });
    const nextWednesday = inferInboundRequestedDate({
      text: "Need by next Wednesday",
      receivedAt: "2026-06-08T14:00:00.000Z",
    });

    expect(friday?.parsedDate).toBe("2026-06-12");
    expect(nextWednesday?.parsedDate).toBe("2026-06-17");
  });

  test("scores product matches using description/category/material knowledge with reasoning", () => {
    const matches = scoreProductKnowledgeCandidates(
      { sourceText: "Need 20 yard signs full color", productName: "Yard Sign", materialText: null },
      [
        {
          id: "product_coroplast",
          name: "4mm Coroplast",
          description: "Weather-resistant corrugated plastic commonly used for yard signs, political signs, realtor signs, event signs, and outdoor promotional signage.",
          category: "Signage",
          materialName: "4mm Coroplast",
          materialCategory: "Rigid Substrate",
          metadataText: "{}",
        },
        {
          id: "product_poster",
          name: "Poster Paper",
          description: "Indoor poster paper.",
          category: "Posters",
          materialName: "Poster Paper",
          materialCategory: "Paper",
          metadataText: "{}",
        },
      ],
      5,
    );

    expect(matches[0].id).toBe("product_coroplast");
    expect(matches[0].confidence).toBeGreaterThanOrEqual(80);
    expect(matches[0].metadata.matchReasons.join(" ")).toContain("yard sign");
    expect(matches[0].metadata.matchBreakdown.descriptionScore).toBeGreaterThan(0);
  });

  test("generates CSR-style missing decisions for yard signs without dimensions or artwork", () => {
    const { repo } = makeRepository();
    const service = new InboundOrderParsingService(repo as any, () => null);
    const refined = service.applyMissingDecisionDetection(parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "YARD SIGNS FULL COLOR IMPRINT SINGLE SIDED",
        productName: "Yard Sign",
        quantity: 20,
        width: null,
        height: null,
        artworkRefs: [],
      }],
      artwork: [],
      missingDecisions: [],
    }) as any);

    expect(refined.missingDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "lineItems.0.dimensions",
        label: "What size are the signs?",
        severity: "blocking",
      }),
      expect.objectContaining({
        field: "lineItems.0.artwork",
        label: "Is artwork supplied for this item?",
      }),
    ]));
  });

  test("normalizes parsed due date from source evidence and stores a warning on low confidence", () => {
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const refined = service.applyDateInference(
      inboundRecord({
        receivedAt: new Date("2026-06-08T12:00:00.000Z"),
        rawPayloadJson: {
          intakeMode: "TEMP_INBOUND",
          bodyText: "Need yard signs by 6/1",
        },
      }) as any,
      parsedDraft({
        order: {
          ...parsedDraft().order,
          requestedDueDate: "2023-06-01",
          warnings: [],
        },
      }) as any,
    );

    expect(refined.order.requestedDueDate).toBe("2027-06-01");
    expect(refined.order.warnings[0].code).toBe("date_inferred_from_context");
  });

  test("extracts machine-readable PDF text for attachment evidence", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Purchase Order 151661\nArrival Due Date MUST EOD 6/11\n3 PVC Signs\n24x36\n3mm White PVC", {
      x: 48,
      y: 720,
      size: 12,
      font,
    });
    const bytes = await pdf.save();

    const extracted = await extractMachineReadablePdfText(Buffer.from(bytes));

    expect(extracted.pageCount).toBe(1);
    expect(extracted.text).toContain("Purchase Order 151661");
    expect(extracted.text).toContain("3mm White PVC");
  });

  test("detects purchase order documents and extracts Brainstorm-style PO fields", () => {
    const poText = [
      "Purchase Order 151661",
      "Purchase Order Date: 06/08/26",
      "Arrival Due Date MUST EOD 6/11",
      "3 PVC Signs",
      "24x36",
      "3mm White PVC",
    ].join("\n");

    const detected = detectAttachmentDocument(poText, "Brainstorm Print PO.pdf");
    const fields = extractPurchaseOrderFields({
      text: poText,
      receivedAt: "2026-06-08T12:00:00.000Z",
    });

    expect(detected.documentType).toBe("purchase_order");
    expect(detected.documentConfidence).toBeGreaterThanOrEqual(70);
    expect(fields).toMatchObject({
      poNumber: "151661",
      dueDate: "2026-06-11",
      quantity: 3,
      productDescription: "PVC Signs",
      material: "3mm White PVC",
      dimensions: "24x36",
    });
    expect(fields.dateCandidates[0]).toMatchObject({
      parsedDate: "2026-06-11",
      classification: "ARRIVAL_DATE",
      sourceText: "Arrival Due Date MUST EOD 6/11",
    });
    expect(fields.fieldSources.dueDate).toMatchObject({
      value: "2026-06-11",
      sourceText: "Arrival Due Date MUST EOD 6/11",
      confidence: expect.any(Number),
    });
  });

  test("classifies dates before choosing requested due date", () => {
    expect(classifyDateSourceText("PO Date 6/8")).toBe("PO_DATE");
    expect(classifyDateSourceText("Need by Friday")).toBe("DUE_DATE");
    expect(classifyDateSourceText("Ship Date 6/10")).toBe("SHIP_DATE");

    const candidates = extractClassifiedDates({
      text: "Purchase Order Date: 06/08/26\nArrival Due Date: MUST EOD 6/11",
      receivedAt: "2026-06-08T12:00:00.000Z",
    });

    expect(candidates[0]).toMatchObject({
      parsedDate: "2026-06-11",
      classification: "ARRIVAL_DATE",
    });
  });

  test("detects conflicts between email body and purchase order attachment", () => {
    const conflicts = detectEvidenceConflicts([
      {
        type: "EMAIL_BODY",
        label: "Email Body",
        rawText: "Please print 50 signs. Need by Friday. PO attached.",
        documentType: "unknown",
        documentConfidence: 0,
        extractionStatus: "not_attempted",
        warnings: [],
      },
      {
        type: "PDF_ATTACHMENT",
        label: "Brainstorm Print PO.pdf",
        sourceId: "file_1",
        fileName: "Brainstorm Print PO.pdf",
        mimeType: "application/pdf",
        rawText: "Purchase Order 151661\n3 PVC Signs",
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 98,
        extractionStatus: "successful",
        poSummary: {
          poNumber: "151661",
          dueDate: "2026-06-09",
          quantity: 3,
          productDescription: "PVC Signs",
          material: "3mm White PVC",
          dimensions: "24x36",
          printSpecs: [],
          dateCandidates: [],
          fieldSources: {},
        },
        warnings: [],
      },
    ]);

    expect(conflicts).toEqual([expect.objectContaining({
      code: "evidence_quantity_conflict",
      message: expect.stringContaining("email (50)"),
    }), expect.objectContaining({
      code: "evidence_due_date_conflict",
    })]);
  });

  test("prioritizes purchase order fields before product matching", () => {
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const evidenceBundle: InboundOrderEvidenceBundle = {
      items: [{
        type: "PDF_ATTACHMENT",
        label: "Brainstorm Print PO.pdf",
        sourceId: "file_1",
        fileName: "Brainstorm Print PO.pdf",
        mimeType: "application/pdf",
        rawText: "Purchase Order 151661\nArrival Due Date MUST EOD 6/11\n3 PVC Signs\n24x36\n3mm White PVC",
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 98,
        extractionStatus: "successful",
        poSummary: {
          poNumber: "151661",
          dueDate: "2026-06-11",
          quantity: 3,
          productDescription: "PVC Signs",
          material: "3mm White PVC",
          dimensions: "24x36",
          printSpecs: [],
          dateCandidates: [],
          fieldSources: {
            dueDate: {
              value: "2026-06-11",
              sourceType: "PDF_ATTACHMENT",
              sourceDocument: "Brainstorm Print PO.pdf",
              sourceText: "Arrival Due Date MUST EOD 6/11",
              confidence: 98,
            },
          },
        },
        warnings: [],
      }],
      conflicts: [],
    };

    const refined = service.applyAttachmentEvidencePriority(parsedDraft({
      lineItems: [],
    }) as any, evidenceBundle);

    expect(refined.order.poNumber).toBe("151661");
    expect(refined.order.requestedDueDate).toBe("2026-06-11");
    expect(refined.lineItems[0]).toMatchObject({
      quantity: 3,
      productName: "PVC Signs",
      materialText: "3mm White PVC",
      width: 24,
      height: 36,
    });
  });

  test("product ranking favors printable material/category/description over accessories", () => {
    const matches = scoreProductKnowledgeCandidates(
      { sourceText: "3 PVC Signs 24x36 3mm White PVC", productName: "PVC Signs", materialText: "3mm White PVC" },
      [
        {
          id: "accessory_stake",
          name: "PVC Sign Stake",
          description: "Accessory hardware for signs.",
          category: "Accessories",
          materialName: "Steel Stake",
          materialCategory: "Hardware",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "printable_pvc",
          name: "3mm White PVC",
          description: "Printable rigid PVC signs and display panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    expect(matches[0].id).toBe("printable_pvc");
    expect(matches[0].metadata.matchBreakdown.materialScore).toBeGreaterThan(0);
  });
});
