import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { PDFDocument, StandardFonts } from "pdf-lib";

jest.mock("../services/pricing/PricingService", () => ({
  priceLineItem: jest.fn(),
}));

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
  reconcileInboundEvidence,
  type InboundOrderEvidenceBundle,
} from "../services/inboundOrders/InboundOrderEvidenceService";
import { inferInboundRequestedDate } from "../services/inboundOrders/inboundOrderDateInference";
import { resolveAiParsingDescription, scoreProductKnowledgeCandidates } from "../storage/inboundProductKnowledgeMatcher";

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

  test("normalizes common quantity words from email body before missing decision detection", async () => {
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "PO-321",
        sender: { name: "Rick Clark", email: "rick@example.com" },
        subject: "Magnets",
        bodyText: "Can you make me two magnets that are 12 x 12 of the attached file thank you",
      },
    }));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      order: {
        ...parsedDraft().order,
        poNumber: "PO-321",
        notes: "Can you make me two magnets that are 12 x 12 of the attached file thank you",
      },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "Magnets that are 12 x 12",
        productName: "Magnets",
        quantity: null,
        width: 12,
        height: 12,
        dimensionsUnit: "in",
        materialText: null,
      }],
    })));
    const service = new InboundOrderParsingService(repo as any, () => provider);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.lineItems[0]).toMatchObject({
      quantity: 2,
      sourceText: expect.stringContaining("two magnets"),
    });
    expect(result.draft?.lineItems[0].warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "quantity_inferred_from_number_word",
        fieldPath: "lineItems.0.quantity",
      }),
    ]));
    expect(result.draft?.missingDecisions.some((decision) => decision.field === "lineItems.0.quantity")).toBe(false);
  });

  test("splits multiple banner sizes into separate TEMP review line items with shared options", async () => {
    const bodyText = "One banner is 2' x 10'. The other banner is 30\" x 60\". All with hems and grommets, just one each.";
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "BANNER-SPLIT",
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "Two banners",
        bodyText,
      },
    }));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      order: {
        ...parsedDraft().order,
        poNumber: "BANNER-SPLIT",
        notes: bodyText,
      },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: bodyText,
        productName: "Banner",
        quantity: 2,
        width: null,
        height: null,
        dimensionsUnit: null,
        optionTexts: [],
        finishingTexts: [],
      }],
    })));
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({
        items: [{
          type: "EMAIL_BODY",
          label: "Email Body",
          rawText: bodyText,
          documentType: "unknown",
          documentConfidence: 0,
          extractionStatus: "not_attempted",
          warnings: [],
        }],
        conflicts: [],
      })),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.lineItems).toHaveLength(2);
    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Banner",
      quantity: 1,
      width: 24,
      height: 120,
      dimensionsUnit: "in",
      optionTexts: expect.arrayContaining(["hems", "grommets"]),
      finishingTexts: expect.arrayContaining(["hems", "grommets"]),
    });
    expect(result.draft?.lineItems[1]).toMatchObject({
      productName: "Banner",
      quantity: 1,
      width: 30,
      height: 60,
      dimensionsUnit: "in",
      optionTexts: expect.arrayContaining(["hems", "grommets"]),
      finishingTexts: expect.arrayContaining(["hems", "grommets"]),
    });
    expect(result.draft?.lineItems[0].productCandidates[0]).toMatchObject({ id: "product_1" });
    expect(result.draft?.lineItems[1].productCandidates[0]).toMatchObject({ id: "product_1" });
    expect(repo.searchProductCandidates).toHaveBeenCalledTimes(2);
    expect(result.draft?.missingDecisions.filter((decision) => decision.field.includes("quantity"))).toHaveLength(0);
    expect(result.draft?.missingDecisions.filter((decision) => decision.field.includes("dimensions"))).toHaveLength(0);
  });

  test("keeps identical same-size items combined as one line item", async () => {
    const bodyText = "Please make two banners that are 2' x 10' with hems and grommets.";
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "BANNER-COMBINED",
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "Two identical banners",
        bodyText,
      },
    }));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      order: {
        ...parsedDraft().order,
        poNumber: "BANNER-COMBINED",
        notes: bodyText,
      },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: bodyText,
        productName: "Banner",
        quantity: 2,
        width: null,
        height: null,
        dimensionsUnit: null,
      }],
    })));
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({
        items: [{
          type: "EMAIL_BODY",
          label: "Email Body",
          rawText: bodyText,
          documentType: "unknown",
          documentConfidence: 0,
          extractionStatus: "not_attempted",
          warnings: [],
        }],
        conflicts: [],
      })),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.lineItems).toHaveLength(1);
    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Banner",
      quantity: 2,
    });
  });

  test("uses Foam Core PO evidence to populate size, quantity, and Foam Board product suggestion", async () => {
    const poText = [
      "Purchase Order No. 200222",
      "Product: Foam Core Sign",
      "Stock: 3/16\" Foam Core",
      "Final Trim: 24\" x 36\"",
      "QTY: 1",
    ].join("\n");
    const poSummary = extractPurchaseOrderFields({
      text: poText,
      receivedAt: "2026-06-19T12:00:00.000Z",
      sourceDocument: "Foam Core PO.pdf",
    });
    const evidenceBundle: InboundOrderEvidenceBundle = {
      items: [{
        type: "PDF_ATTACHMENT",
        label: "Foam Core PO.pdf",
        sourceId: "file_po",
        fileName: "Foam Core PO.pdf",
        mimeType: "application/pdf",
        rawText: poText,
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 96,
        extractionStatus: "successful",
        poSummary,
        warnings: [],
      }],
      conflicts: [],
      reconciliation: reconcileInboundEvidence([{
        type: "PDF_ATTACHMENT",
        label: "Foam Core PO.pdf",
        sourceId: "file_po",
        fileName: "Foam Core PO.pdf",
        mimeType: "application/pdf",
        rawText: poText,
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 96,
        extractionStatus: "successful",
        poSummary,
        warnings: [],
      }]),
    };
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "PO-200222",
        sender: { name: "Foam Buyer", email: "foam@example.com" },
        subject: "Foam Core Sign PO",
        bodyText: "See attached PO.",
      },
    }));
    (repo.searchProductCandidates as any).mockImplementation(async (args: any) => scoreProductKnowledgeCandidates(
      {
        sourceText: args.sourceText,
        productName: args.productName,
        materialText: args.materialText,
        optionTexts: args.optionTexts,
        finishingTexts: args.finishingTexts,
      },
      [
        {
          id: "foam_board",
          name: "Foam Board",
          description: "Lightweight foam board display panels and indoor sign boards.",
          aiParsingDescription: "foam core, foamcore, foam core sign, foam board sign, 3/16 foam core, 3/16 foam board",
          category: "Display Boards",
          materialName: "3/16 White Foam Board",
          materialCategory: "Foam Board",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "pvc",
          name: "PVC",
          description: "Printable PVC signs and rigid display panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
      ],
      args.limit,
    ));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: null,
        productName: null,
        quantity: null,
        width: null,
        height: null,
        dimensionsUnit: null,
        materialText: null,
        optionTexts: [],
      }],
      missingDecisions: [],
    })));
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => evidenceBundle),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Foam Core Sign",
      quantity: 1,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      materialText: "3/16\" Foam Core",
    });
    expect(result.draft?.lineItems[0].productCandidates[0]).toMatchObject({
      id: "foam_board",
      label: "Foam Board",
    });
    expect(result.draft?.lineItems[0].candidateProductIds[0]).toBe("foam_board");
    expect(result.draft?.evidence.reconciliation?.dimensions.sources[0].sourceText).toBe("Final Trim: 24\" x 36\"");
    expect(result.draft?.evidence.reconciliation?.quantity.sources[0].sourceText).toBe("QTY: 1");
  });

  test("deterministically extracts Coroplast quantity, size, print sides, and artwork references from body evidence", async () => {
    const bodyText = [
      "We need these printed on Coroplast.",
      "Please use double-sided copy, 2 prints total.",
      "Final size is 24\" x 36\".",
      "Artwork file: yard-sign-art.pdf",
    ].join("\n");
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "CORO-1",
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "Coroplast signs",
        bodyText,
      },
    }));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      order: {
        ...parsedDraft().order,
        poNumber: "CORO-1",
        notes: bodyText,
      },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: null,
        productName: null,
        quantity: null,
        width: null,
        height: null,
        dimensionsUnit: null,
        materialText: null,
        optionTexts: [],
        finishingTexts: [],
        artworkRefs: [],
      }],
      missingDecisions: [],
    })));
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({ items: [], conflicts: [] })),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Coroplast",
      materialText: "Coroplast",
      quantity: 2,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      optionTexts: expect.arrayContaining(["double-sided"]),
      artworkRefs: expect.arrayContaining(["yard-sign-art.pdf"]),
    });
    expect(result.draft?.missingDecisions.some((decision) => decision.field.includes("quantity"))).toBe(false);
    expect(result.draft?.missingDecisions.some((decision) => decision.field.includes("dimensions"))).toBe(false);
    expect(result.draft?.missingDecisions.some((decision) => decision.field.includes("artwork"))).toBe(false);
    expect(repo.searchProductCandidates).toHaveBeenCalledWith(expect.objectContaining({
      productName: "Coroplast",
      materialText: "Coroplast",
      optionTexts: expect.arrayContaining(["double-sided"]),
    }));
  });

  test("segments distinct Coroplast, directional-sign subset, and banner requests before candidate extraction", () => {
    const bodyText = [
      "20 coroplast signs, 24 x 18 inches, sponsor-sign.pdf",
      "2 informational/directional signs with different content, directional-sign.pdf",
      "1 welcome banner, approximately 8 x 2 feet, welcome-banner.pdf",
    ].join("\n");
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const refined = service.refineParsedDraft(inboundRecord({ rawPayloadJson: { bodyText } }) as any, parsedDraft({
      lineItems: [{ ...parsedDraft().lineItems[0], sourceText: null, productName: null, quantity: null, width: null, height: null, dimensionsUnit: null, artworkRefs: [] }],
    }) as any);

    expect(refined.lineItems).toHaveLength(3);
    expect(refined.lineItems[0]).toMatchObject({ productName: "Coroplast", quantity: 20, width: 24, height: 18, dimensionsUnit: "in" });
    expect(refined.lineItems[1]).toMatchObject({ productName: "Sign", quantity: 2 });
    expect(refined.lineItems[2]).toMatchObject({ productName: "Banner", quantity: 1, width: 96, height: 24, dimensionsUnit: "in" });
    expect(refined.lineItems[0].artworkRefs).toEqual(["sponsor-sign.pdf"]);
    expect(refined.lineItems[2].artworkRefs).toEqual(["welcome-banner.pdf"]);
    expect(refined.lineItems.every((item) => item.warnings.some((itemWarning) => itemWarning.code === "line_item_segmented_from_source"))).toBe(true);
  });

  test("preserves explicit quantity subsets and keeps a same-size total request as one item", () => {
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const subset = service.refineParsedDraft(inboundRecord({ rawPayloadJson: {
      bodyText: "20 signs total: 18 sponsor signs and the other 2 directional signs.",
    } }) as any, parsedDraft({ lineItems: [{ ...parsedDraft().lineItems[0], productName: null, quantity: null, sourceText: null }] }) as any);
    expect(subset.lineItems).toHaveLength(2);
    expect(subset.lineItems.map((item) => item.quantity)).toEqual([18, 2]);

    const sameItem = service.refineParsedDraft(inboundRecord({ rawPayloadJson: {
      bodyText: "20 coroplast signs, all 24 x 18 inches.",
    } }) as any, parsedDraft({ lineItems: [{ ...parsedDraft().lineItems[0], productName: null, quantity: null, sourceText: null }] }) as any);
    expect(sameItem.lineItems).toHaveLength(1);
    expect(sameItem.lineItems[0]).toMatchObject({ quantity: 20, width: 24, height: 18 });
  });

  test("extracts Qnty 1 and excludes a company signature from line items", () => {
    const bodyText = [
      "Zane-Another ACM sign! Qnty 1, 96\" x 48\", one-sided on 3mm ACM.",
      "T3 Signs, Inc.",
      "sales@t3signs.example",
    ].join("\n");
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const base = parsedDraft({
      customer: { ...parsedDraft().customer, companyName: "T3 Signs, Inc." },
      order: { ...parsedDraft().order, notes: bodyText },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "Zane-Another ACM sign! Qnty 1, 96\" x 48\", one-sided on 3mm ACM.",
        productName: "Coroplast",
        materialText: "3mm ACM",
        quantity: null,
        width: null,
        height: null,
        dimensionsUnit: null,
      }, {
        ...parsedDraft().lineItems[0],
        sourceText: "T3 Signs, Inc.",
        productName: "T3 Signs, Inc.",
        materialText: null,
        quantity: null,
        width: null,
        height: null,
        dimensionsUnit: null,
      }],
      missingDecisions: [{
        field: "lineItems.1.quantity",
        label: "What quantity is needed?",
        reason: "No clear quantity was detected.",
        severity: "blocking",
      }],
    });

    const refined = service.refineParsedDraft(inboundRecord({ rawPayloadJson: { bodyText } }) as any, base as any);

    expect(refined.lineItems).toHaveLength(1);
    expect(refined.lineItems[0]).toMatchObject({ quantity: 1, width: 96, height: 48 });
    expect(refined.lineItems[0].optionTexts).toContain("single-sided");
    expect(refined.missingDecisions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.1.quantity" }),
    ]));
    expect(refined.globalWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "signature_line_item_removed" }),
    ]));
  });

  test("keeps differently sized banners and their artwork candidate-specific", () => {
    const bodyText = "1 banner 4 x 8 feet, north.pdf\n1 banner 8 x 2 feet, south.pdf";
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const refined = service.refineParsedDraft(inboundRecord({ rawPayloadJson: { bodyText } }) as any, parsedDraft({
      lineItems: [{ ...parsedDraft().lineItems[0], productName: null, quantity: null, sourceText: null, artworkRefs: [] }],
    }) as any);
    expect(refined.lineItems).toHaveLength(2);
    expect(refined.lineItems.map((item) => [item.width, item.height, item.artworkRefs])).toEqual([
      [48, 96, ["north.pdf"]],
      [96, 24, ["south.pdf"]],
    ]);
  });

  test("infers bare banner dimensions as feet while keeping unresolved quantity and body-only filenames as references", async () => {
    const bodyText = "Please quote the 5x8 banner. Use 5x8 kasey.jpg for reference and add a pole pocket.";
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "BANNER-5X8",
        sender: { name: "Ada Lovelace", email: "ada@example.com" },
        subject: "5×8 banner with pole pocket",
        bodyText,
      },
    }));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      order: {
        ...parsedDraft().order,
        poNumber: "BANNER-5X8",
        notes: bodyText,
      },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: null,
        productName: null,
        quantity: null,
        width: null,
        height: null,
        dimensionsUnit: null,
        materialText: null,
        optionTexts: [],
        finishingTexts: [],
        artworkRefs: [],
      }],
      artwork: [],
      missingDecisions: [],
    })));
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({ items: [], conflicts: [] })),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Banner",
      quantity: null,
      width: 5,
      height: 8,
      dimensionsUnit: "ft",
      optionTexts: expect.arrayContaining(["pole pocket"]),
      finishingTexts: expect.arrayContaining(["pole pocket"]),
      artworkRefs: expect.arrayContaining(["5x8 kasey.jpg"]),
    });
    expect(result.draft?.artwork).toHaveLength(0);
    expect(result.draft?.missingDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.quantity", severity: "blocking" }),
      expect.objectContaining({ field: "lineItems.0.polePocketDetails", severity: "warning" }),
    ]));
    expect(result.draft?.missingDecisions.some((decision) => decision.field === "lineItems.0.dimensions")).toBe(false);
    expect(result.draft?.missingDecisions.some((decision) => decision.field === "lineItems.0.artwork")).toBe(false);
  });

  test("adds compact customer intelligence to parse prompts and stored parsed drafts when customer resolution is confident", async () => {
    const { repo, attempts } = makeRepository();
    const provider = makeProvider(JSON.stringify(parsedDraft()));
    const summary = {
      customer: { id: "customer_1", companyName: "Ada Signs", email: "billing@example.com" },
      scopeMonths: 24,
      maxRecords: 50,
      recordCount: 2,
      generatedAt: "2026-06-09T12:00:00.000Z",
      recentProducts: [{ productId: "product_1", label: "Vinyl Banner", lastSeenAt: "2026-05-01T12:00:00.000Z" }],
      frequentProducts: [{ productId: "product_1", label: "Vinyl Banner", count: 2, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
      frequentMaterials: [{ label: "13oz Vinyl", count: 2, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
      frequentDimensions: [{ label: "24x36", width: 24, height: 36, unit: "in", count: 2, lastSeenAt: "2026-05-01T12:00:00.000Z" }],
      frequentFinishing: [],
      commonTerminology: [{ term: "banner", count: 2 }],
      recentOrderReferences: [{ sourceType: "order", sourceId: "order_1", reference: "1001", createdAt: "2026-05-01T12:00:00.000Z", productSummary: "Vinyl Banner" }],
    };
    const customerIntelligence = {
      buildSummaryForSourceEvidence: jest.fn(async () => summary),
      buildSummaryForParsedDraft: jest.fn(async () => summary),
    };
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({ items: [], conflicts: [] })),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any, customerIntelligence as any);

    await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(customerIntelligence.buildSummaryForSourceEvidence).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      senderEmail: "ada@example.com",
      senderName: "Ada Lovelace",
    }));
    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining("Customer intelligence summary"),
    }));
    expect(attempts[0].parsedDraft.customerIntelligence).toMatchObject({
      customer: { id: "customer_1", companyName: "Ada Signs" },
      frequentProducts: [expect.objectContaining({ label: "Vinyl Banner" })],
    });
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("continues with source evidence when advisory customer intelligence is unavailable", async () => {
    const { repo, attempts } = makeRepository();
    const provider = makeProvider(JSON.stringify(parsedDraft()));
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({ items: [], conflicts: [] })),
    };
    const customerIntelligence = {
      buildSummaryForSourceEvidence: jest.fn(async () => {
        throw new Error("historical context temporarily unavailable");
      }),
      buildSummaryForParsedDraft: jest.fn(async () => null),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any, customerIntelligence as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.latestAttempt.status).toBe("success");
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    expect(attempts[0].parsedDraft.globalWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "customer_intelligence_unavailable", severity: "info" }),
    ]));
  });

  test("keeps a validated semantic draft reviewable when each candidate subsystem is unavailable", async () => {
    const { repo, attempts, getCurrentRecord } = makeRepository(inboundRecord({
      rawPayloadJson: {
        intakeMode: "TEMP_INBOUND",
        reference: "BANNER-REVIEW-ONLY",
        sender: { name: "Rick Clark", email: "graphic.solutions@sbcglobal.net" },
        subject: "Baner Needed",
        bodyText: "Banner with hems and grommets.",
      },
    }));
    repo.searchCustomerCandidates.mockRejectedValue(new Error("customer query unavailable"));
    repo.searchContactCandidates.mockRejectedValue(new Error("contact query unavailable"));
    repo.searchProductCandidates.mockRejectedValue(new Error("product query unavailable"));
    const provider = makeProvider(JSON.stringify(parsedDraft({
      customer: { ...parsedDraft().customer, sourceName: "Rick Clark", sourceEmail: "graphic.solutions@sbcglobal.net" },
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "Banner with hems and grommets.",
        productName: "Banner",
        quantity: null,
        optionTexts: ["hems", "grommets"],
        finishingTexts: ["hems", "grommets"],
      }],
    })));
    const customerIntelligence = {
      buildSummaryForSourceEvidence: jest.fn(async () => null),
      buildSummaryForParsedDraft: jest.fn(async () => {
        throw new Error("customer history unavailable");
      }),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, undefined, customerIntelligence as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.latestAttempt.status).toBe("success");
    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Banner",
      optionTexts: expect.arrayContaining(["hems", "grommets"]),
      finishingTexts: expect.arrayContaining(["hems", "grommets"]),
      candidateProductIds: [],
    });
    expect(result.draft?.customer).toMatchObject({
      sourceName: "Rick Clark",
      sourceEmail: "graphic.solutions@sbcglobal.net",
      customerCandidates: [],
      contactCandidates: [],
    });
    expect(result.draft?.customer.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "customer_candidates_unavailable" }),
      expect.objectContaining({ code: "contact_candidates_unavailable" }),
    ]));
    expect(result.draft?.lineItems[0].warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "product_candidates_unavailable" }),
    ]));
    expect(result.draft?.globalWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "customer_intelligence_unavailable", severity: "info" }),
    ]));
    expect(result.draft?.missingDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "customer" }),
      expect.objectContaining({ field: "lineItems.0.product" }),
      expect.objectContaining({ field: "lineItems.0.dimensions", severity: "blocking" }),
    ]));
    expect(attempts[0].warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "customer_candidates_unavailable" }),
      expect.objectContaining({ code: "product_candidates_unavailable" }),
      expect.objectContaining({ code: "customer_intelligence_unavailable" }),
    ]));
    expect(getCurrentRecord().status).toBe("needs_review");
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("keeps unmatched products as an explicit review decision without changing their semantic interpretation", async () => {
    const { repo, getCurrentRecord } = makeRepository();
    repo.searchProductCandidates.mockResolvedValue([]);
    const provider = makeProvider(JSON.stringify(parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: "Two 24 x 36 banners with hems and grommets",
        productName: "Banner",
        quantity: 2,
        width: 24,
        height: 36,
        dimensionsUnit: "in",
        optionTexts: ["hems", "grommets"],
        finishingTexts: ["hems", "grommets"],
      }],
    })));
    const service = new InboundOrderParsingService(repo as any, () => provider);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.latestAttempt.status).toBe("success");
    expect(result.draft?.lineItems[0]).toMatchObject({
      productName: "Banner",
      quantity: 2,
      width: 24,
      height: 36,
      optionTexts: expect.arrayContaining(["hems", "grommets"]),
      productCandidates: [],
    });
    expect(result.draft?.missingDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.product", severity: "warning" }),
    ]));
    expect(getCurrentRecord().status).toBe("needs_review");
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("records an evidence-preparation failure and safely allows a later retry", async () => {
    const { repo, attempts, getCurrentRecord } = makeRepository();
    const provider = makeProvider(JSON.stringify(parsedDraft()));
    const evidenceService = {
      buildEvidenceBundle: jest
        .fn()
        .mockRejectedValueOnce(new Error("temporary evidence-store failure"))
        .mockResolvedValue({ items: [], conflicts: [] }),
    };
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const failed = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(failed.latestAttempt.status).toBe("failed");
    expect(failed.latestAttempt.errors[0]).toMatchObject({ code: "evidence_collection_failed" });
    expect(getCurrentRecord().status).toBe("needs_review");
    expect(provider.generateJson).not.toHaveBeenCalled();

    const retried = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(retried.latestAttempt.status).toBe("success");
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.status)).toEqual(["success", "failed"]);
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
      classification: "DUE_DATE",
      sourceText: "Arrival Due Date MUST EOD 6/11",
    });
    expect(fields.fieldSources.dueDate).toMatchObject({
      value: "2026-06-11",
      sourceText: "Arrival Due Date MUST EOD 6/11",
      confidence: expect.any(Number),
    });
  });

  test("extracts Foam Core PO rows with final trim size and quantity", () => {
    const poText = [
      "Purchase Order No. 200222",
      "Product: Foam Core Sign",
      "Stock: 3/16\" Foam Core",
      "Final Trim: 24\" x 36\"",
      "QTY: 1",
    ].join("\n");

    const fields = extractPurchaseOrderFields({
      text: poText,
      receivedAt: "2026-06-19T12:00:00.000Z",
    });

    expect(fields).toMatchObject({
      poNumber: "200222",
      productDescription: "Foam Core Sign",
      material: "3/16\" Foam Core",
      dimensions: "24\" x 36\"",
      quantity: 1,
    });
    expect(fields.fieldSources.productDescription).toMatchObject({
      sourceText: "Product: Foam Core Sign",
    });
    expect(fields.fieldSources.material).toMatchObject({
      sourceText: "Stock: 3/16\" Foam Core",
    });
    expect(fields.fieldSources.dimensions).toMatchObject({
      sourceText: "Final Trim: 24\" x 36\"",
    });
    expect(fields.fieldSources.quantity).toMatchObject({
      sourceText: "QTY: 1",
    });
  });

  test("extracts Brainstorm PO fields from collapsed PDF text with explicit PO number labels", () => {
    const poText = [
      "Customer: Brainstorm Print Contact: Shawn Fears Purchase Order No. 151661 Purchase Order Date: 06/08/26 Arrival Due Date: MUST EOD 6/11",
      "Qty Item Description 3 PVC Signs 24x36 3mm White PVC",
    ].join(" ");

    const fields = extractPurchaseOrderFields({
      text: poText,
      receivedAt: "2026-06-08T12:00:00.000Z",
    });

    expect(fields).toMatchObject({
      poNumber: "151661",
      customer: "Brainstorm Print",
      contact: "Shawn Fears",
      dueDate: "2026-06-11",
      quantity: 3,
      productDescription: "PVC Signs",
      material: "3mm White PVC",
      dimensions: "24x36",
    });
    expect(fields.dateCandidates[0]).toMatchObject({
      parsedDate: "2026-06-11",
      classification: "DUE_DATE",
      sourceText: "Arrival Due Date: MUST EOD 6/11",
    });
    expect(fields.fieldSources.dueDate).toMatchObject({
      value: "2026-06-11",
      sourceDocument: "Purchase Order 151661",
      sourceText: "Arrival Due Date: MUST EOD 6/11",
    });
    expect(fields.dateCandidates.some((candidate) => (
      candidate.parsedDate === "2026-06-08" && candidate.classification === "PO_DATE"
    ))).toBe(true);
  });

  test("does not treat purchase order label words as the PO number", () => {
    expect(extractPurchaseOrderFields({
      text: "Purchase Order Number: 151661",
      receivedAt: "2026-06-08T12:00:00.000Z",
    }).poNumber).toBe("151661");
    expect(extractPurchaseOrderFields({
      text: "Purchase Order No. 151661",
      receivedAt: "2026-06-08T12:00:00.000Z",
    }).poNumber).toBe("151661");
    expect(extractPurchaseOrderFields({
      text: "Purchase Order Date: 06/08/26 Arrival Due Date: MUST EOD 6/11",
      receivedAt: "2026-06-08T12:00:00.000Z",
    }).poNumber).toBeNull();
  });

  test("classifies dates before choosing requested due date", () => {
    expect(classifyDateSourceText("PO Date 6/8")).toBe("PO_DATE");
    expect(classifyDateSourceText("Arrival Due Date; MUST EOD 6/11")).toBe("DUE_DATE");
    expect(classifyDateSourceText("Need by Friday")).toBe("DUE_DATE");
    expect(classifyDateSourceText("Ship Date 6/10")).toBe("SHIP_DATE");

    const candidates = extractClassifiedDates({
      text: "Purchase Order Date: 06/08/26\nArrival Due Date: MUST EOD 6/11",
      receivedAt: "2026-06-08T12:00:00.000Z",
    });

    expect(candidates[0]).toMatchObject({
      parsedDate: "2026-06-11",
      classification: "DUE_DATE",
    });
  });

  test("classifies separate dates when PDF extraction collapses PO and arrival dates into one line", () => {
    const candidates = extractClassifiedDates({
      text: "Purchase Order Date: 06/08/26 Arrival Due Date: MUST EOD 6/11",
      receivedAt: "2026-06-08T12:00:00.000Z",
    });

    expect(candidates[0]).toMatchObject({
      parsedDate: "2026-06-11",
      classification: "DUE_DATE",
      sourceText: "Arrival Due Date: MUST EOD 6/11",
    });
    expect(candidates[1]).toMatchObject({
      parsedDate: "2026-06-08",
      classification: "PO_DATE",
      sourceText: "Purchase Order Date: 06/08/26",
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

  test("reconciles Brainstorm thread evidence across PO, rush text, artwork links, and pricing", () => {
    const poSummary = extractPurchaseOrderFields({
      text: [
        "Purchase Order No. 151793",
        "Total QTY: 11",
        "11 versions",
        "1 each of 11 signs",
        "Item Description: Yard Signs",
        "Size: 24x18",
        "Stock: 4mm Coroplast",
        "Approved Price: $550.00",
      ].join("\n"),
      receivedAt: "2026-06-24T14:00:00.000Z",
      sourceDocument: "Brainstorm PO 151793.pdf",
    });
    const items: InboundOrderEvidenceBundle["items"] = [{
      type: "PDF_ATTACHMENT",
      label: "Brainstorm PO 151793.pdf",
      sourceId: "file_po",
      fileName: "Brainstorm PO 151793.pdf",
      mimeType: "application/pdf",
      rawText: [
        "Purchase Order No. 151793",
        "Total QTY: 11",
        "11 versions",
        "1 each of 11 signs",
        "Item Description: Yard Signs",
        "Size: 24x18",
        "Stock: 4mm Coroplast",
        "Approved Price: $550.00",
      ].join("\n"),
      pageCount: 1,
      documentType: "purchase_order",
      documentConfidence: 98,
      extractionStatus: "successful",
      poSummary,
      warnings: [],
    }, {
      type: "THREAD_MESSAGE",
      label: "Thread Message 2 (2026-06-24T16:20:00.000Z)",
      sourceId: "gmail_msg_2",
      rawText: [
        "This is a RUSH for pickup Monday morning.",
        "Artwork link: https://drive.google.com/file/d/brainstorm-art",
      ].join("\n"),
      documentType: "unknown",
      documentConfidence: 0,
      extractionStatus: "not_attempted",
      warnings: [],
    }];

    const reconciliation = reconcileInboundEvidence(items);

    expect(reconciliation.quantity).toMatchObject({
      value: 11,
      status: "confirmed",
    });
    expect(reconciliation.quantity.sources.map((source) => source.sourceText)).toEqual(expect.arrayContaining([
      expect.stringContaining("Total QTY: 11"),
      expect.stringContaining("11 versions"),
      expect.stringContaining("1 each of 11"),
    ]));
    expect(reconciliation.rushStatus).toMatchObject({
      value: "rush",
      status: "confirmed",
    });
    expect(reconciliation.artworkStatus).toMatchObject({
      value: "supplied",
      status: "confirmed",
    });
    expect(reconciliation.pricingStatus).toMatchObject({
      value: "approved_pricing_found",
      status: "confirmed",
    });
    expect(reconciliation.artworkStatus.sources[0]?.sourceText).toContain("https://drive.google.com/file/d/brainstorm-art");
    expect(reconciliation.pricingStatus.sources[0]?.sourceText).toContain("Approved Price");
  });

  test("uses reconciled Brainstorm evidence to repair parsed quantity and artwork status", () => {
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const items: InboundOrderEvidenceBundle["items"] = [{
      type: "PDF_ATTACHMENT",
      label: "Brainstorm PO 151793.pdf",
      sourceId: "file_po",
      fileName: "Brainstorm PO 151793.pdf",
      mimeType: "application/pdf",
      rawText: "Purchase Order No. 151793\nTotal QTY: 11\n11 versions\n1 each of 11 signs\nItem Description: Yard Signs\nSize: 24x18\nStock: 4mm Coroplast\nApproved Price: $550.00",
      pageCount: 1,
      documentType: "purchase_order",
      documentConfidence: 98,
      extractionStatus: "successful",
      poSummary: extractPurchaseOrderFields({
        text: "Purchase Order No. 151793\nTotal QTY: 11\n11 versions\n1 each of 11 signs\nItem Description: Yard Signs\nSize: 24x18\nStock: 4mm Coroplast\nApproved Price: $550.00",
        receivedAt: "2026-06-24T14:00:00.000Z",
        sourceDocument: "Brainstorm PO 151793.pdf",
      }),
      warnings: [],
    }, {
      type: "THREAD_MESSAGE",
      label: "Thread Message 2",
      sourceId: "gmail_msg_2",
      rawText: "This is a RUSH for pickup Monday morning.\nArtwork link: https://drive.google.com/file/d/brainstorm-art",
      documentType: "unknown",
      documentConfidence: 0,
      extractionStatus: "not_attempted",
      warnings: [],
    }];
    const reconciliation = reconcileInboundEvidence(items);
    const evidenceBundle: InboundOrderEvidenceBundle = {
      items,
      conflicts: Object.values(reconciliation).flatMap((field) => field.conflicts),
      reconciliation,
    };

    const refined = service.refineParsedDraft(
      inboundRecord({ receivedAt: new Date("2026-06-24T14:00:00.000Z") }) as any,
      parsedDraft({
        lineItems: [{
          ...parsedDraft().lineItems[0],
          productName: "Yard Signs",
          quantity: 1,
          artworkRefs: [],
        }],
        artwork: [],
      }) as any,
      evidenceBundle,
    );

    expect(refined.lineItems[0]).toMatchObject({
      productName: "Yard Signs",
      quantity: 11,
      width: 24,
      height: 18,
      materialText: "4mm Coroplast",
    });
    expect(refined.lineItems[0].artworkRefs).toContain("Artwork supplied via source evidence");
    expect(refined.artwork[0]).toMatchObject({
      purpose: "artwork",
      likelyLineItemIndex: 0,
    });
    expect(refined.order.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "evidence_reconciliation_rush_priority" }),
    ]));
    expect(refined.evidence.reconciliation?.quantity.value).toBe(11);
    expect(refined.missingDecisions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.artwork" }),
    ]));
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

  test("persists purchase order field sources in the review-only parsed draft", async () => {
    const { repo, attempts } = makeRepository();
    const poSummary = extractPurchaseOrderFields({
      text: [
        "Customer: Brainstorm Print Contact: Shawn Fears Purchase Order No. 151661",
        "Purchase Order Date: 06/08/26 Arrival Due Date; MUST EOD 6/11",
        "Qty Item Description 3 PVC Signs 24x36 Stock: 3mm White PVC",
      ].join(" "),
      receivedAt: "2026-06-08T12:00:00.000Z",
    });
    const evidenceBundle: InboundOrderEvidenceBundle = {
      items: [{
        type: "PDF_ATTACHMENT",
        label: "Brainstorm Print PO.pdf",
        sourceId: "file_1",
        fileName: "Brainstorm Print PO.pdf",
        mimeType: "application/pdf",
        rawText: "Brainstorm PO text",
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 98,
        extractionStatus: "successful",
        poSummary,
        warnings: [],
      }],
      conflicts: [],
    };
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => evidenceBundle),
    };
    const provider = makeProvider(JSON.stringify(parsedDraft({
      order: {
        ...parsedDraft().order,
        requestedDueDate: "2026-06-08",
      },
      lineItems: [],
    })));
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    const result = await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.draft?.order.requestedDueDate).toBe("2026-06-11");
    expect(attempts[0].parsedDraft.evidence.items[0].poSummary.fieldSources).toMatchObject({
      poNumber: {
        value: "151661",
        sourceDocument: "Purchase Order 151661",
      },
      dueDate: {
        value: "2026-06-11",
        sourceType: "PDF_ATTACHMENT",
        sourceDocument: "Purchase Order 151661",
        sourceText: "Arrival Due Date; MUST EOD 6/11",
      },
      quantity: { value: 3 },
      dimensions: { value: "24x36" },
      material: { value: "3mm White PVC" },
      productDescription: { value: "PVC Signs" },
    });
    expect(result.draft?.missingDecisions).toEqual([expect.objectContaining({
      field: "lineItems.0.artwork",
      severity: "warning",
    })]);
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
    expect(repo.matchCustomerWithEvent).not.toHaveBeenCalled();
    expect(repo.matchLineItemProductWithEvent).not.toHaveBeenCalled();
  });

  test("includes extracted PO PDF text and source attribution in parse prompt evidence", async () => {
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const evidenceBundle: InboundOrderEvidenceBundle = {
      items: [{
        type: "PDF_ATTACHMENT",
        label: "Purchase Order 151534.pdf",
        sourceId: "file_po",
        fileName: "Purchase Order 151534.pdf",
        mimeType: "application/pdf",
        rawText: "Purchase Order No 151534\nQty 10 Yard Signs\n24x18 Coroplast",
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 98,
        extractionStatus: "successful",
        poSummary: extractPurchaseOrderFields({
          text: "Purchase Order No 151534\nQty 10 Yard Signs\n24x18 Coroplast",
          receivedAt: "2026-06-19T12:00:00.000Z",
          sourceDocument: "Purchase Order 151534.pdf",
        }),
        warnings: [],
      }, {
        type: "EMAIL_BODY",
        label: "Email Body",
        rawText: "Artwork to follow.",
        documentType: "unknown",
        documentConfidence: 0,
        extractionStatus: "not_attempted",
        warnings: [],
      }],
      conflicts: [],
    };

    const prompt = await service.buildInboundOrderParsePrompt(
      "org_1",
      inboundRecord({
        sourceType: "email",
        receivedAt: new Date("2026-06-19T12:00:00.000Z"),
        rawPayloadJson: {
          intakeMode: "TEMP_INBOUND",
          sender: { name: "Shawn Fears", email: "shawn@brainstormprint.com" },
          subject: "PO attached",
          bodyText: "Artwork to follow.",
        },
      }) as any,
      evidenceBundle,
    );

    expect(prompt.user).toContain("\"type\":\"PDF_ATTACHMENT\"");
    expect(prompt.user).toContain("Purchase Order No 151534");
    expect(prompt.user).toContain("\"documentType\":\"purchase_order\"");
    expect(prompt.user).toContain("\"sourceType\":\"PDF_ATTACHMENT\"");
    expect(prompt.user).toContain("Qty 10 Yard Signs");
  });

  test("passes saved manual attachment classifications into parse evidence", async () => {
    const { repo } = makeRepository(inboundRecord({
      sourceType: "email",
      rawPayloadJson: {
        sender: { email: "buyer@example.com" },
        subject: "Files attached",
        bodyText: "Please review.",
      },
    }));
    repo.listFiles.mockResolvedValue([{
      id: "file_1",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      inboundLineItemId: null,
      fileRecordId: null,
      sourceFilename: "final-art.pdf",
      role: "po",
      mimeType: "application/pdf",
      sizeBytes: 12000,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "att_1",
      providerMessageId: "msg_1",
      contentDisposition: "attachment",
      metadataJson: {},
      reviewNotes: null,
      createdQuoteAttachmentId: null,
      createdOrderAttachmentId: null,
      createdAt: new Date("2026-06-09T12:00:00.000Z"),
      updatedAt: new Date("2026-06-09T12:00:00.000Z"),
    }] as any);
    (repo as any).listReviewSnapshots = jest.fn(async () => [{
      id: "snapshot_1",
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      snapshotType: "approval",
      snapshotVersion: 1,
      payloadJson: {
        status: "draft",
        reviewedCustomerJson: {
          sourceName: null,
          sourceEmail: null,
          sourcePhone: null,
          companyName: null,
          selectedCustomerId: null,
          selectedCustomerSource: null,
          selectedCustomerReason: null,
          selectedCustomerConfidence: null,
          selectedContactId: null,
          selectedContactSource: null,
          selectedContactReason: null,
          selectedContactConfidence: null,
          unresolvedCustomer: false,
          unresolvedContact: false,
          notes: null,
        },
        reviewedOrderJson: {
          intent: "unknown",
          poNumber: null,
          dueDate: null,
          priority: "normal",
          shipMethod: null,
          fulfillmentType: "unknown",
          internalNotes: null,
          customerNotes: null,
        },
        reviewedLineItemsJson: [],
        reviewedArtworkJson: {
          status: "missing",
          refs: [],
          notes: null,
          unassignedAttachments: [{
            fileId: "file_1",
            fileRecordId: null,
            filename: "final-art.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12000,
            role: "artwork",
            source: "unresolved",
            confidence: 100,
            reason: "Staff manually classified as Artwork.",
            classification: "ARTWORK",
            classificationConfidence: 100,
            classificationReasons: ["Staff manually classified as Artwork."],
            classificationSource: "manual_override",
            automaticClassification: "PO",
            automaticClassificationConfidence: 88,
            automaticClassificationReasons: ["filename contained PO"],
            manualOverride: true,
            learningEvidence: {
              inboundRecordId: "inbound_1",
              attachmentKey: "file:file_1",
              originalAutomaticClassification: "PO",
              correctedManualClassification: "ARTWORK",
              capturedAt: "2026-06-09T12:05:00.000Z",
            },
          }],
        },
        missingDecisionsJson: [],
        warningsJson: [],
        unsupportedRequestsJson: [],
        customerIntelligenceJson: null,
        reviewNotes: null,
        metadata: { snapshotKind: "editable_review_draft" },
      },
      createdByUserId: "user_1",
      createdAt: new Date("2026-06-09T12:05:00.000Z"),
      updatedAt: new Date("2026-06-09T12:05:00.000Z"),
    }]);
    const evidenceService = {
      buildEvidenceBundle: jest.fn(async () => ({ items: [], conflicts: [] })),
    };
    const provider = makeProvider(JSON.stringify(parsedDraft()));
    const service = new InboundOrderParsingService(repo as any, () => provider, evidenceService as any);

    await service.parseInboundOrderRecord({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const manualClassifications = (evidenceService.buildEvidenceBundle as any).mock.calls[0]?.[0]?.manualClassifications as Map<string, any>;
    expect(manualClassifications.get("file:file_1")).toMatchObject({
      classification: "ARTWORK",
      automaticClassification: "PO",
      automaticConfidence: 88,
      learningEvidence: expect.objectContaining({
        correctedManualClassification: "ARTWORK",
      }),
    });
  });

  test("includes manual classification influence in parse prompt evidence", async () => {
    const service = new InboundOrderParsingService(makeRepository().repo as any, () => null);
    const evidenceBundle: InboundOrderEvidenceBundle = {
      items: [{
        type: "PDF_ATTACHMENT",
        label: "final-art.pdf",
        sourceId: "file_1",
        fileName: "final-art.pdf",
        mimeType: "application/pdf",
        rawText: null,
        pageCount: null,
        documentType: "artwork_reference",
        documentConfidence: 100,
        extractionStatus: "failed",
        poSummary: null,
        manualClassificationUsed: true,
        automaticClassification: "PO",
        manualClassification: "ARTWORK",
        finalClassification: "ARTWORK",
        classificationInfluence: "Manual attachment classification used: Artwork.",
        learningEvidence: {
          inboundRecordId: "inbound_1",
          attachmentKey: "file:file_1",
          originalAutomaticClassification: "PO",
          correctedManualClassification: "ARTWORK",
        },
        warnings: [{
          code: "manual_attachment_classification_used",
          message: "Manual attachment classification used: Artwork.",
          severity: "info",
          fieldPath: null,
        }],
      }],
      conflicts: [],
    };

    const prompt = await service.buildInboundOrderParsePrompt("org_1", inboundRecord() as any, evidenceBundle);

    expect(prompt.system).toContain("Manual attachment classification is authoritative");
    expect(prompt.user).toContain("\"manualClassificationUsed\":true");
    expect(prompt.user).toContain("\"automaticClassification\":\"PO\"");
    expect(prompt.user).toContain("\"finalClassification\":\"ARTWORK\"");
    expect(prompt.user).toContain("Manual attachment classification used");
  });

  test("product ranking prioritizes exact material match over generic description text", () => {
    const matches = scoreProductKnowledgeCandidates(
      { sourceText: "PVC Signs 24x36 Stock: 3mm White PVC", productName: "PVC Signs", materialText: "3mm White PVC" },
      [
        {
          id: "acm",
          name: "ACM / Dibond / Max Metal",
          description: "Rigid sign panels for outdoor signs, retail signs, PVC signs, and display graphics.",
          category: "Rigid Signs",
          materialName: "Aluminum Composite Material",
          materialCategory: "ACM",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "pvc",
          name: "PVC",
          description: "Printable PVC signs and rigid display panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    const byId = Object.fromEntries(matches.map((match) => [match.id, match]));
    expect(matches[0].id).toBe("pvc");
    expect(matches[0].metadata.matchBreakdown.materialScore).toBeGreaterThan(byId.acm?.metadata.matchBreakdown.materialScore ?? 0);
    expect(matches[0].metadata.matchBreakdown.combinedConfidence).toBeGreaterThan(byId.acm?.metadata.matchBreakdown.combinedConfidence ?? 0);
    expect(matches[0].metadata.matchBreakdown.keywordScore).toBeDefined();
  });

  test("product ranking maps Foam Core terminology to the existing Foam Board product", () => {
    const matches = scoreProductKnowledgeCandidates(
      {
        sourceText: "Product: Foam Core Sign Stock: 3/16\" Foam Core Final Trim: 24\" x 36\" QTY: 1",
        productName: "Foam Core Sign",
        materialText: "3/16\" Foam Core",
      },
      [
        {
          id: "foam_board",
          name: "Foam Board",
          description: "Lightweight foam board display panels and indoor sign boards.",
          category: "Display Boards",
          materialName: "3/16 White Foam Board",
          materialCategory: "Foam Board",
          metadataText: JSON.stringify({ aliases: ["foam core", "foamcore", "foam sign"] }),
          isService: false,
        },
        {
          id: "pvc",
          name: "PVC",
          description: "Printable PVC signs and rigid display panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "acm",
          name: "ACM / Dibond / Max Metal",
          description: "Rigid aluminum composite sign panels for outdoor business signs and displays.",
          category: "Rigid Signs",
          materialName: "Aluminum Composite Material",
          materialCategory: "ACM",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    expect(matches[0].id).toBe("foam_board");
    expect(matches[0].confidence).toBeGreaterThanOrEqual(90);
    expect(matches[0].metadata.matchReasons.join(" ")).toMatch(/foam core|foam board|metadata alias/i);
  });

  test("exact product name match still outranks AI parsing description alias matches", () => {
    const matches = scoreProductKnowledgeCandidates(
      {
        sourceText: "Need one Foam Board sign 24 x 36",
        productName: "Foam Board",
        materialText: null,
      },
      [
        {
          id: "foam_board_exact",
          name: "Foam Board",
          description: "Lightweight foam board display panels and indoor sign boards.",
          aiParsingDescription: "foam core, foamcore, foam core sign, foam board sign, 3/16 foam core, 3/16 foam board",
          category: "Display Boards",
          materialName: "3/16 White Foam Board",
          materialCategory: "Foam Board",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "foam_display_alias",
          name: "Display Board",
          description: "Generic display board product.",
          aiParsingDescription: "foam board, foam core, foam board sign",
          category: "Display Boards",
          materialName: "Foam Board",
          materialCategory: "Foam Board",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    expect(matches[0].id).toBe("foam_board_exact");
    expect(matches[0].metadata.matchBreakdown.nameScore).toBeGreaterThanOrEqual(90);
  });

  test("product ranking uses AI parsing description before customer-facing description fallback", () => {
    const matches = scoreProductKnowledgeCandidates(
      { sourceText: "3 PVC Signs 24x36 3mm White PVC", productName: "PVC Signs", materialText: "3mm White PVC" },
      [
        {
          id: "acm",
          name: "ACM / Dibond / Max Metal",
          description: "Rigid sign panels with aluminum faces and a PVC core.",
          aiParsingDescription: "Use for aluminum composite, ACM, Dibond, MaxMetal, or metal faced sign panels.",
          category: "Rigid Signs",
          materialName: "Aluminum Composite Material",
          materialCategory: "ACM",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "pvc",
          name: "Rigid Sheet Sign",
          description: "Short-term indoor and outdoor rigid panel.",
          aiParsingDescription: "Use for PVC signs, Sintra, foam PVC, 3mm white PVC, and plastic sign panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    const byId = Object.fromEntries(matches.map((match) => [match.id, match]));
    expect(matches[0].id).toBe("pvc");
    expect(matches[0].metadata.matchBreakdown.aiParsingScore).toBeGreaterThan(0);
    expect(matches[0].metadata.matchBreakdown.aiParsingScore).toBeGreaterThanOrEqual(byId.acm?.metadata.matchBreakdown.descriptionScore ?? 0);
    expect(matches[0].metadata.matchReasons.join(" ")).toContain("AI parsing description");
  });

  test("linked AI parsing flag resolves description as parsing text", () => {
    expect(resolveAiParsingDescription({
      aiParsingDescription: "",
      aiParsingDescriptionLinkedToDescription: true,
      description: "Use for PVC signs and Sintra panels.",
    })).toBe("Use for PVC signs and Sintra panels.");

    expect(resolveAiParsingDescription({
      aiParsingDescription: "Prefer this explicit parsing hint.",
      aiParsingDescriptionLinkedToDescription: true,
      description: "Customer-facing text.",
    })).toBe("Prefer this explicit parsing hint.");
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

  test("candidate separation penalizes incompatible products when aluminum evidence is strong", () => {
    const matches = scoreProductKnowledgeCandidates(
      {
        sourceText: "Please quote 3 aluminum signs, 24x36, printed single sided.",
        productName: "Aluminum Signs",
        materialText: "aluminum",
      },
      [
        {
          id: "acm",
          name: "ACM / Dibond / Max Metal",
          description: "Rigid aluminum composite sign panels for outdoor business signs and displays.",
          aiParsingDescription: "Use for aluminum signs, ACM, Dibond, polymetal, MaxMetal, and metal faced sign panels.",
          category: "Rigid Signs",
          materialName: "Aluminum Composite Material",
          materialCategory: "ACM",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "sign_vinyl",
          name: "Sign Vinyl",
          description: "Printed adhesive vinyl graphics for signs, windows, and decals.",
          aiParsingDescription: "Use for vinyl decals, adhesive sign vinyl, stickers, and window graphics.",
          category: "Vinyl Graphics",
          materialName: "Adhesive Vinyl",
          materialCategory: "Vinyl",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "pvc",
          name: "PVC",
          description: "Printable PVC signs and rigid display panels.",
          aiParsingDescription: "Use for PVC signs, Sintra, foam PVC, expanded PVC, and plastic sign panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "yard_stakes",
          name: "Yard Stakes",
          description: "Hardware accessory stakes for yard signs.",
          category: "Accessories",
          materialName: "Steel Stake",
          materialCategory: "Hardware",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    const byId = Object.fromEntries(matches.map((match) => [match.id, match]));
    const confidence = (id: string) => byId[id]?.confidence ?? 0;
    expect(matches[0].id).toBe("acm");
    expect(confidence("acm")).toBeGreaterThanOrEqual(90);
    expect(confidence("pvc")).toBeLessThanOrEqual(35);
    expect(confidence("sign_vinyl")).toBeLessThanOrEqual(20);
    expect(confidence("yard_stakes")).toBeLessThanOrEqual(10);
    if (byId.pvc) expect(byId.pvc.metadata.matchBreakdown.negativeEvidencePenalty).toBeGreaterThan(0);
    if (byId.sign_vinyl) expect(byId.sign_vinyl.metadata.matchBreakdown.negativeEvidencePenalty).toBeGreaterThan(0);
  });

  test("candidate separation favors PVC for Sintra and separates ACM/vinyl false positives", () => {
    const matches = scoreProductKnowledgeCandidates(
      { sourceText: "Need three Sintra signs 24x36 single sided.", productName: "Sintra Signs", materialText: "Sintra" },
      [
        {
          id: "pvc",
          name: "PVC",
          description: "Printable PVC signs and rigid display panels.",
          aiParsingDescription: "Use for PVC signs, Sintra, foam PVC, expanded PVC, PALIGHT, and plastic sign panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "foam_board",
          name: "Foam Board",
          description: "Lightweight foam board display panels and indoor presentation boards.",
          category: "Display Boards",
          materialName: "Foam Board",
          materialCategory: "Foam Board",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "acm",
          name: "ACM / Dibond / Max Metal",
          description: "Rigid aluminum composite sign panels for outdoor business signs and displays.",
          aiParsingDescription: "Use for aluminum signs, ACM, Dibond, polymetal, MaxMetal, and metal faced sign panels.",
          category: "Rigid Signs",
          materialName: "Aluminum Composite Material",
          materialCategory: "ACM",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "vinyl",
          name: "Sign Vinyl",
          description: "Printed adhesive vinyl graphics for signs, windows, and decals.",
          category: "Vinyl Graphics",
          materialName: "Adhesive Vinyl",
          materialCategory: "Vinyl",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    const byId = Object.fromEntries(matches.map((match) => [match.id, match]));
    const confidence = (id: string) => byId[id]?.confidence ?? 0;
    expect(matches[0].id).toBe("pvc");
    expect(confidence("pvc")).toBeGreaterThanOrEqual(90);
    expect(confidence("foam_board")).toBeLessThanOrEqual(45);
    expect(confidence("acm")).toBeLessThanOrEqual(20);
    expect(confidence("vinyl")).toBeLessThanOrEqual(10);
  });

  test("candidate separation strongly favors ACM for Dibond brand evidence", () => {
    const matches = scoreProductKnowledgeCandidates(
      { sourceText: "Quote Dibond panels 24x36 printed single sided.", productName: "Dibond Panels", materialText: "Dibond" },
      [
        {
          id: "acm",
          name: "ACM / Dibond / Max Metal",
          description: "Rigid aluminum composite sign panels for outdoor business signs and displays.",
          aiParsingDescription: "Use for aluminum signs, ACM, Dibond, polymetal, MaxMetal, and metal faced sign panels.",
          category: "Rigid Signs",
          materialName: "Aluminum Composite Material",
          materialCategory: "ACM",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "pvc",
          name: "PVC",
          description: "Printable PVC signs and rigid display panels.",
          aiParsingDescription: "Use for PVC signs, Sintra, foam PVC, expanded PVC, and plastic sign panels.",
          category: "Rigid Signs",
          materialName: "3mm White PVC",
          materialCategory: "PVC",
          metadataText: "{}",
          isService: false,
        },
        {
          id: "vinyl",
          name: "Sign Vinyl",
          description: "Printed adhesive vinyl graphics for signs, windows, and decals.",
          category: "Vinyl Graphics",
          materialName: "Adhesive Vinyl",
          materialCategory: "Vinyl",
          metadataText: "{}",
          isService: false,
        },
      ],
      5,
    );

    const byId = Object.fromEntries(matches.map((match) => [match.id, match]));
    const confidence = (id: string) => byId[id]?.confidence ?? 0;
    expect(matches[0].id).toBe("acm");
    expect(confidence("acm")).toBeGreaterThanOrEqual(90);
    expect(confidence("pvc")).toBeLessThanOrEqual(15);
    expect(confidence("vinyl")).toBeLessThanOrEqual(5);
  });
});
