import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../services/pricing/PricingService", () => ({
  priceLineItem: jest.fn(),
}));

jest.mock("../services/orders/orderTaxCalculationService", () => ({
  calculateAuthoritativeOrderTax: jest.fn(),
}));

import {
  InboundOrderReviewDraftValidationError,
  InboundOrderService,
  InboundOrderTransitionError,
} from "../services/inboundOrders/InboundOrderService";
import { extractPurchaseOrderFields } from "../services/inboundOrders/InboundOrderEvidenceService";
import { hydrateInboundPbv2Selections } from "@shared/inboundOrderPbv2Options";
import { calculateAuthoritativeOrderTax } from "../services/orders/orderTaxCalculationService";

const mockPriceLineItem = jest.fn<(...args: any[]) => Promise<any>>();

function pricingResult(lineTotalCents = 4500) {
  return {
    pbv2TreeVersionId: "tree_pvc",
    lineTotalCents,
    breakdown: {
      baseCents: lineTotalCents,
      optionsCents: 0,
      totalCents: lineTotalCents,
      pricingMethod: "pbv2",
    },
    pbv2SnapshotJson: {
      pricingSystem: "pbv2",
      treeVersionId: "tree_pvc",
      treeJson: {},
      selections: {},
      runtimeSelectionContext: {},
      selectedOptions: [{ groupLabel: "Thickness", optionLabel: "3mm White PVC" }],
      visibleNodeIds: ["thickness"],
      pricedAt: "2026-06-09T12:30:00.000Z",
      quantity: 3,
      pricing: {
        baseCents: lineTotalCents,
        optionsCents: 0,
        totalCents: lineTotalCents,
        pricingMethod: "pbv2",
      },
    },
  } as any;
}

function mockSuccessfulPricing() {
  mockPriceLineItem.mockResolvedValue(pricingResult());
  (calculateAuthoritativeOrderTax as jest.Mock).mockResolvedValue({
    totals: {
      taxRate: 0.07,
      taxAmount: 3.15,
      taxableSubtotal: 45,
      lineItemsWithTax: [{ taxAmount: 3.15, isTaxableSnapshot: true }],
    },
  });
}

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
    rawPayloadJson: {},
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
      sourceName: "Shawn Fears",
      sourceEmail: "shawn@example.com",
      sourcePhone: null,
      companyName: "Brainstorm Print",
      candidateCustomerIds: ["customer_1"],
      candidateContactIds: ["contact_1"],
      customerCandidates: [{ id: "customer_1", label: "Brainstorm Print", confidence: 92, reason: "Matched company", metadata: {} }],
      contactCandidates: [{ id: "contact_1", label: "Shawn Fears", confidence: 90, reason: "Matched contact", metadata: {} }],
      confidence: 90,
      warnings: [],
    },
    order: {
      requestedDueDate: "2026-06-11",
      requestedShipMethod: null,
      requestedPickup: null,
      poNumber: "151661",
      notes: null,
      confidence: 98,
      warnings: [],
    },
    lineItems: [{
      sourceText: "3 PVC Signs 24x36 3mm White PVC",
      productName: "PVC Signs",
      candidateProductIds: ["product_pvc"],
      productCandidates: [{ id: "product_pvc", label: "PVC", confidence: 94, reason: "Matched material", metadata: {} }],
      quantity: 3,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      materialText: "3mm White PVC",
      optionTexts: [],
      finishingTexts: [],
      artworkRefs: [],
      confidence: 98,
      warnings: [],
    }],
    artwork: [],
    globalWarnings: [],
    missingDecisions: [{
      field: "lineItems.0.artwork",
      label: "Is artwork supplied for this item?",
      reason: "No artwork file or artwork reference was detected in the source evidence.",
      severity: "warning",
    }],
    evidence: { items: [], conflicts: [] },
    ...overrides,
  };
}

function parsedDraftWithPoPricing(pricing: Record<string, any>) {
  return parsedDraft({
    evidence: {
      items: [{
        type: "PDF_ATTACHMENT",
        label: "Purchase Order 151661.pdf",
        sourceId: "file_po",
        fileName: "Purchase Order 151661.pdf",
        mimeType: "application/pdf",
        rawText: pricing.evidenceText ?? "Purchase order pricing evidence",
        pageCount: 1,
        documentType: "purchase_order",
        documentConfidence: 98,
        extractionStatus: "successful",
        poSummary: {
          poNumber: "151661",
          customer: "Brainstorm Print",
          contact: "Shawn Fears",
          dueDate: "2026-06-11",
          quantity: 3,
          productDescription: "PVC Signs",
          material: "3mm White PVC",
          dimensions: "24x36",
          printSpecs: [],
          shippingNotes: null,
          price: pricing.price ?? null,
          pricing: {
            approvedPriceCents: pricing.approvedPriceCents ?? null,
            unitPriceCents: pricing.unitPriceCents ?? null,
            extendedPriceCents: pricing.extendedPriceCents ?? null,
            rushFeesCents: pricing.rushFeesCents ?? null,
            totalPriceCents: pricing.totalPriceCents ?? null,
            alternatePricingNotes: pricing.alternatePricingNotes ?? [],
            evidenceText: pricing.evidenceText ?? null,
            sourceDocument: "Purchase Order 151661.pdf",
          },
          versionCount: null,
          dateCandidates: [],
          fieldSources: {},
        },
        warnings: [],
      }],
      conflicts: [],
    },
  });
}

function parseAttempt(overrides: Record<string, any> = {}) {
  return {
    id: "attempt_1",
    organizationId: "org_1",
    inboundOrderRecordId: "inbound_1",
    status: "success",
    provider: "test",
    model: "test-model",
    rawPromptHash: "hash",
    rawResponse: {},
    repairedResponse: null,
    parsedDraft: parsedDraft(),
    confidence: 92,
    warnings: [],
    errors: [],
    createdAt: new Date("2026-06-09T12:01:00.000Z"),
    ...overrides,
  };
}

function inboundFile(overrides: Record<string, any> = {}) {
  const now = new Date("2026-06-09T12:00:00.000Z");
  return {
    id: "file_artwork_1",
    organizationId: "org_1",
    inboundRecordId: "inbound_1",
    inboundLineItemId: null,
    fileRecordId: "file_record_artwork_1",
    sourceFilename: "pvc-sign-24x36-artwork.pdf",
    role: "artwork",
    mimeType: "application/pdf",
    sizeBytes: 12345,
    checksum: null,
    status: "available",
    providerAttachmentId: null,
    providerMessageId: null,
    contentDisposition: "attachment",
    metadataJson: {},
    reviewNotes: null,
    createdQuoteAttachmentId: null,
    createdOrderAttachmentId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRepository(record = inboundRecord(), latestAttempt = parseAttempt()) {
  let currentRecord: any = { ...record };
  let currentAttempt = { ...latestAttempt };
  const snapshots: any[] = [];
  let eventCounter = 0;
  const repo = {
    getRecord: jest.fn(async () => currentRecord),
    getSource: jest.fn(async () => null),
    listLineItems: jest.fn(async () => []),
    listFiles: jest.fn(async () => []),
    updateFile: jest.fn(async ({ fileId, patch }: any) => ({ id: fileId, ...patch })),
    listWarnings: jest.fn(async () => []),
    listDecisionFlags: jest.fn(async () => []),
    listEvents: jest.fn(async () => []),
    listEnabledEmailIgnoreRules: jest.fn(async () => []),
    listEnabledEmailTrustRules: jest.fn(async () => []),
    senderEmailMatchesCustomerContact: jest.fn(async () => false),
    senderDomainMatchesCustomerDomain: jest.fn(async () => false),
    getLatestParseAttempt: jest.fn(async () => currentAttempt),
    setLatestParseAttempt: (attempt: any) => {
      currentAttempt = attempt;
    },
    listReviewSnapshots: jest.fn(async () => snapshots),
    getLatestReviewSnapshot: jest.fn(async () => snapshots[0] ?? null),
    createReviewSnapshotWithEvent: jest.fn(async ({ snapshot, event }: any) => {
      const created = {
        id: `snapshot_${snapshots.length + 1}`,
        ...snapshot,
        createdAt: new Date(`2026-06-09T12:${String(snapshots.length + 2).padStart(2, "0")}:00.000Z`),
      };
      snapshots.unshift(created);
      eventCounter += 1;
      return { snapshot: created, event: { id: `event_${eventCounter}`, ...event } };
    }),
    updateRecordWithEvent: jest.fn(async ({ patch, event }: any) => {
      currentRecord = { ...currentRecord, ...patch, updatedAt: new Date("2026-06-09T12:10:00.000Z") };
      eventCounter += 1;
      return { record: currentRecord, event: { id: `event_${eventCounter}`, ...event } };
    }),
    createEvent: jest.fn(async (event: any) => {
      eventCounter += 1;
      return { id: `event_${eventCounter}`, createdAt: new Date("2026-06-09T12:10:00.000Z"), ...event };
    }),
    getCustomer: jest.fn(async (_organizationId: string, customerId: string) => (
      customerId === "customer_1"
        ? { id: "customer_1", companyName: "Brainstorm Print", email: "billing@example.com", phone: null, status: "active" }
        : null
    )),
    getContactForCustomer: jest.fn(async (_organizationId: string, customerId: string, contactId: string) => (
      customerId === "customer_1" && contactId === "contact_1"
        ? { id: "contact_1", customerId: "customer_1", firstName: "Shawn", lastName: "Fears", email: "shawn@example.com", phone: null, mobile: null }
        : null
    )),
    getProduct: jest.fn(async (_organizationId: string, productId: string) => (
      productId === "product_pvc"
        ? { id: "product_pvc", name: "PVC Signs", category: "Signs", productType: "wide_roll", isTaxable: true }
        : null
    )),
    getProductActivePbv2Tree: jest.fn(async (_organizationId: string, productId: string) => (
      productId === "product_pvc"
        ? {
            product: { id: "product_pvc", name: "PVC Signs", pbv2ActiveTreeVersionId: null },
            activeTree: null,
          }
        : null
    )),
    searchCustomers: jest.fn(async (_organizationId: string, search: string | null) => {
      const value = String(search ?? "").toLowerCase();
      if (value.includes("brainstorm") || value.includes("shawn@example.com")) {
        return [{ id: "customer_1", companyName: "Brainstorm Print", email: "billing@example.com", phone: null, status: "active" }];
      }
      return [];
    }),
    searchCustomerContacts: jest.fn(async (_organizationId: string, customerId: string | null, search: string | null) => {
      const value = String(search ?? "").toLowerCase();
      if (customerId === "customer_1" && (value.includes("shawn") || value.includes("shawn@example.com"))) {
        return [{
          id: "contact_1",
          customerId: "customer_1",
          name: "Shawn Fears",
          firstName: "Shawn",
          lastName: "Fears",
          email: "shawn@example.com",
          phone: null,
          mobile: null,
          isPrimary: true,
        }];
      }
      return [];
    }),
    searchProductCandidates: jest.fn(async () => []),
    listCustomerHistoricalContext: jest.fn(async () => [{
      sourceType: "order",
      sourceId: "order_1",
      reference: "1001",
      createdAt: "2026-05-10T12:00:00.000Z",
      productId: "product_pvc",
      productName: "PVC Signs",
      description: "PVC Signs 24x36 3mm White PVC",
      width: "24.00",
      height: "36.00",
      quantity: 3,
      specsJson: { material: "3mm White PVC" },
      optionSelectionsJson: null,
      selectedOptions: [{ optionName: "Contour Cutting", value: "No" }],
      materialUsages: [{ materialName: "3mm White PVC" }],
      materialUsageJson: null,
    }]),
    claimInboundOrderForOrderConversion: jest.fn(async () => {
      if (currentRecord.status !== "ready" || currentRecord.createdOrderId || currentRecord.createdQuoteId) return null;
      currentRecord = { ...currentRecord, status: "processing", reviewOutcome: "order_conversion_requested" };
      return currentRecord;
    }),
    markInboundOrderConvertedToOrder: jest.fn(async ({ orderId, actorUserId }: any) => {
      currentRecord = {
        ...currentRecord,
        status: "submitted",
        reviewOutcome: "order_created",
        createdOrderId: orderId,
        matchedOrderId: orderId,
        submittedByUserId: actorUserId,
        submittedAt: new Date("2026-06-09T12:30:00.000Z"),
      };
      return currentRecord;
    }),
    markInboundOrderConversionFailed: jest.fn(async ({ message }: any) => {
      currentRecord = { ...currentRecord, status: "ready", reviewOutcome: "order_conversion_failed" };
      eventCounter += 1;
      return currentRecord;
    }),
    createQuoteDraftFromInboundReview: jest.fn(),
    matchCustomerWithEvent: jest.fn(),
    matchLineItemProductWithEvent: jest.fn(),
  };
  return { repo, snapshots, getRecord: () => currentRecord };
}

function makeOrderRepository(overrides: Record<string, any> = {}) {
  const createdOrder = {
    id: "order_1",
    organizationId: "org_1",
    orderNumber: "1001",
    status: "new",
    state: "open",
    paymentStatus: "unpaid",
    fulfillmentStatus: "pending",
    createdAt: "2026-06-09T12:30:00.000Z",
    updatedAt: "2026-06-09T12:30:00.000Z",
    lineItems: [{
      id: "order_line_1",
      orderId: "order_1",
      productId: "product_pvc",
      description: "PVC Signs",
      quantity: 3,
      status: "new",
      workflowState: "new",
      requiresPrepress: false,
      requiresProofApproval: false,
      approvedProofVersionId: null,
      specsJson: {
        inbound: {
          recordId: "inbound_1",
          sourceLineItemId: null,
        },
      },
    }],
    ...overrides.order,
  };
  return {
    createOrder: jest.fn(async () => createdOrder),
    createOrderAttachment: jest.fn(async (attachment: any) => ({
      id: `order_attachment_${attachment.fileRecordId}`,
      ...attachment,
    })),
    getOrderById: jest.fn(async (_organizationId: string, orderId: string) => (
      orderId === createdOrder.id ? createdOrder : undefined
    )),
    getContact: jest.fn(async (_organizationId: string, contactId: string) => (
      contactId === "contact_independent"
        ? { id: "contact_independent", customerId: null, firstName: "Casey", lastName: "Contact", email: "casey@example.com", phone: null, mobile: null }
        : null
    )),
    addOrderInternalNote: jest.fn(async (note: any) => ({ id: "order_note_1", ...note })),
    createOrderAuditLog: jest.fn(async (log: any) => ({ id: "audit_1", createdAt: new Date("2026-06-09T12:30:00.000Z"), ...log })),
    createdOrder,
  };
}

function requiredPbv2Tree() {
  return {
    schemaVersion: 2,
    rootNodeIds: ["thickness", "sides", "contour"],
    nodes: {
      thickness: {
        id: "thickness",
        kind: "question",
        label: "Thickness",
        input: { type: "select", required: true, selectionKey: "thickness" },
        choices: [{ id: "3mm_white", value: "3mm_white", label: "3mm White PVC" }],
      },
      sides: {
        id: "sides",
        kind: "question",
        label: "Sides",
        input: { type: "select", required: true, selectionKey: "sides" },
        choices: [
          { id: "single", value: "single", label: "Single Sided / 4/0" },
          { id: "double", value: "double", label: "Double Sided" },
        ],
      },
      contour: {
        id: "contour",
        kind: "question",
        label: "Contour Cutting",
        input: { type: "select", required: true, selectionKey: "contour_cutting", defaultValue: "none" },
        choices: [{ id: "none", value: "none", label: "No Contour Cutting" }],
      },
    },
  };
}

function finishingOptionTree(args: {
  selectionKey: string;
  label: string;
  choiceLabel: string;
  choiceValue?: string;
}) {
  return {
    schemaVersion: 2,
    rootNodeIds: [args.selectionKey],
    nodes: {
      [args.selectionKey]: {
        id: args.selectionKey,
        kind: "question",
        label: args.label,
        input: { type: "select", required: false, selectionKey: args.selectionKey },
        choices: [{
          id: args.choiceValue ?? args.selectionKey,
          value: args.choiceValue ?? args.selectionKey,
          label: args.choiceLabel,
        }],
      },
    },
  };
}

function finishingOptionTreeWithChoices(args: {
  selectionKey: string;
  label: string;
  choices: Array<{ label: string; value: string }>;
}) {
  return {
    schemaVersion: 2,
    rootNodeIds: [args.selectionKey],
    nodes: {
      [args.selectionKey]: {
        id: args.selectionKey,
        kind: "question",
        label: args.label,
        input: { type: "select", required: false, selectionKey: args.selectionKey },
        choices: args.choices.map((choice) => ({
          id: choice.value,
          value: choice.value,
          label: choice.label,
        })),
      },
    },
  };
}

function treeWithoutFinishingSupport() {
  return {
    schemaVersion: 2,
    rootNodeIds: ["thickness"],
    nodes: {
      thickness: {
        id: "thickness",
        kind: "question",
        label: "Thickness",
        input: { type: "select", required: false, selectionKey: "thickness", defaultValue: "3mm" },
        choices: [{ id: "3mm", value: "3mm", label: "3mm" }],
      },
    },
  };
}

async function buildDraftForUnsupportedRequestCase(args: {
  productId: string;
  productLabel: string;
  sourceText: string;
  finishingTexts?: string[];
  treeJson: Record<string, unknown>;
}) {
  const attempt = parseAttempt({
    parsedDraft: parsedDraft({
      lineItems: [{
        ...parsedDraft().lineItems[0],
        sourceText: args.sourceText,
        productName: args.productLabel,
        candidateProductIds: [args.productId],
        productCandidates: [{ id: args.productId, label: args.productLabel, confidence: 94, reason: "Controlled product match", metadata: {} }],
        materialText: args.productLabel,
        optionTexts: [],
        finishingTexts: args.finishingTexts ?? [],
      }],
      missingDecisions: [],
      globalWarnings: [],
    }),
  });
  const { repo } = makeRepository(inboundRecord(), attempt);
  (repo.getProductActivePbv2Tree as any).mockImplementation(async (_organizationId: string, productId: string) => (
    productId === args.productId
      ? {
          product: { id: args.productId, name: args.productLabel, pbv2ActiveTreeVersionId: `tree_${args.productId}` },
          activeTree: { id: `tree_${args.productId}`, treeJson: args.treeJson },
        }
      : null
  ));
  const service = new InboundOrderService(repo as any);
  return service.getReviewDraft({
    organizationId: "org_1",
    inboundRecordId: "inbound_1",
    actorUserId: "user_1",
  });
}

function completePbv2Selections() {
  return {
    schemaVersion: 2 as const,
    selected: {
      thickness: { value: "3mm_white" },
      sides: { value: "single" },
      contour_cutting: { value: "none" },
    },
  };
}

describe("InboundOrderService editable review draft", () => {
  test("bulk classification skips unsafe artwork and warns when metadata-only files cannot be used", async () => {
    const safeFile = inboundFile({ id: "file_safe", fileRecordId: null, role: "reference", status: "available", metadataJson: {} });
    const quarantinedFile = inboundFile({ id: "file_quarantined", role: "reference", status: "quarantined", metadataJson: { attachmentState: "scan_pending" } });
    const repo = {
      getRecord: jest.fn(async () => inboundRecord()),
      getFile: jest.fn(async (_organizationId: string, _inboundRecordId: string, fileId: string) => (
        fileId === safeFile.id ? safeFile : fileId === quarantinedFile.id ? quarantinedFile : null
      )),
      updateFile: jest.fn(async ({ fileId, patch }: any) => ({
        ...(fileId === safeFile.id ? safeFile : quarantinedFile),
        ...patch,
      })),
      createEvent: jest.fn(async () => undefined),
    };
    const service = new InboundOrderService(repo as any);

    const result = await service.bulkUpdateAttachmentClassification({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      fileIds: [safeFile.id, quarantinedFile.id],
      classification: "ARTWORK",
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ id: safeFile.id, role: "artwork" });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: safeFile.id, message: expect.stringContaining("Metadata-only") }),
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: quarantinedFile.id, message: expect.stringContaining("Unsafe or quarantined") }),
    ]));
    expect(repo.updateFile).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSuccessfulPricing();
  });

  test("initializes a review draft from the latest parse attempt", async () => {
    const { repo, snapshots } = makeRepository();
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.status).toBe("draft");
    expect(draft.initializedFromParse).toBe(true);
    expect(draft.sourceParseAttemptId).toBe("attempt_1");
    expect(draft.reviewedCustomerJson.companyName).toBe("Brainstorm Print");
    expect(draft.reviewedLineItemsJson[0]).toMatchObject({
      productName: "PVC",
      selectedProductId: "product_pvc",
      selectedProductSource: "ai_inferred",
      quantity: 3,
      quantitySource: "ai_inferred",
      width: 24,
      height: 36,
      dimensionsSource: "ai_inferred",
    });
    expect(snapshots[0].payloadJson.metadata.snapshotKind).toBe("editable_review_draft");
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("persists customer intelligence on initialized review drafts", async () => {
    const { repo, snapshots } = makeRepository();
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.customerIntelligenceJson).toMatchObject({
      customer: { id: "customer_1", companyName: "Brainstorm Print" },
      recordCount: 1,
      frequentProducts: [expect.objectContaining({ label: "PVC Signs", count: 1 })],
      frequentMaterials: [expect.objectContaining({ label: "3mm White PVC", count: 1 })],
      recentOrderReferences: [expect.objectContaining({ sourceType: "order", reference: "1001" })],
    });
    expect(snapshots[0].payloadJson.customerIntelligenceJson).toEqual(draft.customerIntelligenceJson);
    expect(repo.listCustomerHistoricalContext).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      customerId: "customer_1",
    }));
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("persists the semantic review draft when optional customer intelligence is unavailable", async () => {
    const { repo, snapshots } = makeRepository();
    repo.listCustomerHistoricalContext.mockRejectedValueOnce(new Error("historical context unavailable"));
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.status).toBe("draft");
    expect(draft.customerIntelligenceJson).toBeNull();
    expect(draft.warningsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "customer_intelligence_unavailable",
        message: "Customer history suggestions were partially unavailable.",
        severity: "info",
      }),
    ]));
    expect(snapshots).toHaveLength(1);
  });

  test("leaves customer intelligence empty when no customer is resolved", async () => {
    const attempt = parseAttempt({
      parsedDraft: parsedDraft({
        customer: {
          ...parsedDraft().customer,
          candidateCustomerIds: [],
          candidateContactIds: [],
          customerCandidates: [],
          contactCandidates: [],
          companyName: "Unknown Buyer",
          sourceEmail: "unknown@example.com",
        },
      }),
    });
    const { repo } = makeRepository(inboundRecord(), attempt);
    repo.searchCustomers.mockResolvedValue([]);
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedCustomerJson.selectedCustomerId).toBeNull();
    expect(draft.customerIntelligenceJson).toBeNull();
    expect(repo.listCustomerHistoricalContext).not.toHaveBeenCalled();
  });

  test("leaves low-confidence product candidates unresolved instead of selecting the first candidate", async () => {
    const attempt = parseAttempt({
      parsedDraft: parsedDraft({
        lineItems: [{
          ...parsedDraft().lineItems[0],
          sourceText: "Need a lightweight rigid display board",
          productName: "Display board",
          candidateProductIds: ["product_foam"],
          productCandidates: [{ id: "product_foam", label: "Foam Board", confidence: 62, reason: "Ambiguous display board wording", metadata: {} }],
        }],
      }),
    });
    const { repo } = makeRepository(inboundRecord(), attempt);
    (repo.searchProductCandidates as any).mockResolvedValue([]);
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0]).toMatchObject({
      selectedProductId: null,
      selectedProductSource: null,
      productUnresolved: true,
      productName: "Display board",
    });
  });

  test("resolves Foam Core PO evidence to the existing Foam Board product in the review draft", async () => {
    const attempt = parseAttempt({
      parsedDraft: parsedDraft({
        lineItems: [{
          ...parsedDraft().lineItems[0],
          sourceText: "Product: Foam Core Sign Stock: 3/16\" Foam Core Final Trim: 24\" x 36\" QTY: 1",
          productName: "Foam Core Sign",
          candidateProductIds: ["product_foam"],
          productCandidates: [{
            id: "product_foam",
            label: "Foam Board",
            confidence: 82,
            reason: "AI parsing description matched foam core, foamcore, foam core sign, foam board sign, 3/16 foam core, 3/16 foam board.",
            metadata: {},
          }],
          quantity: 1,
          width: 24,
          height: 36,
          dimensionsUnit: "in",
          materialText: "3/16\" Foam Core",
          optionTexts: [],
          finishingTexts: [],
        }],
        missingDecisions: [],
      }),
    });
    const { repo } = makeRepository(inboundRecord(), attempt);
    (repo.searchProductCandidates as any).mockResolvedValue([{
      id: "product_foam",
      label: "Foam Board",
      confidence: 82,
      reason: "AI parsing description matched foam core aliases.",
      metadata: {},
    }]);
    (repo.getProductActivePbv2Tree as any).mockImplementation(async (_organizationId: string, productId: string) => (
      productId === "product_foam"
        ? {
            product: { id: "product_foam", name: "Foam Board", pbv2ActiveTreeVersionId: null },
            activeTree: null,
          }
        : null
    ));
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0]).toMatchObject({
      selectedProductId: "product_foam",
      interpretedProductId: "product_foam",
      interpretedProductConfidence: 95,
      productUnresolved: false,
      productName: "Foam Board",
      quantity: 1,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
    });
    expect(draft.reviewedLineItemsJson[0].interpretedProductReason).toContain("Exact material evidence matched Foam Board.");
  });

  test("initializes a CSR-ready interpreted draft with customer, contact, date, product, and PBV2 defaults", async () => {
    const attempt = parseAttempt({
      parsedDraft: parsedDraft({
        customer: {
          ...parsedDraft().customer,
          sourceEmail: "shawn@brainstormprint.com",
          candidateCustomerIds: [],
          candidateContactIds: [],
          customerCandidates: [],
          contactCandidates: [],
        },
        order: {
          ...parsedDraft().order,
          requestedDueDate: "Arrival Due Date; MUST EOD 6/11",
        },
        lineItems: [{
          ...parsedDraft().lineItems[0],
          sourceText: "PVC Signs 24 x 36 Prints: 4/0",
          productName: "PVC Signs",
          candidateProductIds: ["product_pvc"],
          productCandidates: [{ id: "product_pvc", label: "PVC Signs", confidence: 82, reason: "Parsed literal PVC text", metadata: {} }],
          optionTexts: ["4/0"],
        }],
      }),
    });
    const { repo } = makeRepository(inboundRecord(), attempt);
    repo.searchCustomers.mockImplementation(async (_organizationId: string, search: string | null) => {
      const value = String(search ?? "").toLowerCase();
      if (value.includes("brainstorm") || value.includes("brainstormprint.com")) {
        return [{ id: "customer_1", companyName: "Brainstorm Print", email: "billing@example.com", phone: null, status: "active" }];
      }
      return [];
    });
    repo.searchCustomerContacts.mockImplementation(async (_organizationId: string, customerId: string | null, search: string | null) => {
      const value = String(search ?? "").toLowerCase();
      if (customerId === "customer_1" && (value.includes("shawn") || value.includes("brainstormprint.com"))) {
        return [{
          id: "contact_1",
          customerId: "customer_1",
          name: "Shawn Fears",
          firstName: "Shawn",
          lastName: "Fears",
          email: "shawn@brainstormprint.com",
          phone: null,
          mobile: null,
          isPrimary: true,
        }];
      }
      return [];
    });
    (repo.searchProductCandidates as any).mockResolvedValue([
      {
        id: "product_acm",
        label: "ACM Signs",
        confidence: 100,
        reason: "catalog material and customer history matched ACM signs",
        metadata: {},
      },
      {
        id: "product_pvc",
        label: "PVC",
        confidence: 86,
        reason: "catalog product name matched PVC signage",
        metadata: {},
      },
    ]);
    (repo.getProductActivePbv2Tree as any).mockImplementation(async (_organizationId: string, productId: string) => (
      productId === "product_pvc"
        ? {
            product: { id: "product_pvc", name: "PVC", pbv2ActiveTreeVersionId: "tree_pvc" },
            activeTree: { id: "tree_pvc", treeJson: requiredPbv2Tree() },
          }
        : null
    ));
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedCustomerJson).toMatchObject({
      selectedCustomerId: "customer_1",
      selectedCustomerSource: "crm_match",
      selectedContactId: "contact_1",
      selectedContactSource: "crm_match",
    });
    expect(draft.reviewedCustomerJson.selectedCustomerReason).toEqual(expect.stringContaining("Matched by company name."));
    expect(draft.reviewedCustomerJson.selectedContactReason).toEqual(expect.stringContaining("Matched by email."));
    expect(draft.reviewedCustomerJson.selectedContactConfidence).toBe(100);
    expect(draft.reviewedOrderJson.dueDate).toBe("2026-06-11");
    expect(draft.reviewedLineItemsJson[0]).toMatchObject({
      selectedProductId: "product_pvc",
      interpretedProductId: "product_pvc",
      interpretedProductConfidence: 95,
      pbv2TreeVersionId: "tree_pvc",
    });
    expect(draft.reviewedLineItemsJson[0].interpretedProductReason).toEqual(expect.stringContaining("Exact material evidence matched PVC."));
    expect(draft.reviewedLineItemsJson[0].optionSelectionsJson).toMatchObject({
      schemaVersion: 2,
      selected: {
        sides: { value: "single", note: "Source evidence", origin: "SOURCE_EVIDENCE", evidence: "4/0" },
        contour_cutting: { value: "none", note: "Default", origin: "DEFAULT" },
      },
    });
    expect(draft.reviewedLineItemsJson[0].pbv2OptionSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ selectionKey: "contour_cutting", source: "product_default", origin: "DEFAULT", evidence: null }),
      expect.objectContaining({ selectionKey: "sides", source: "deterministic_print_spec_rule", origin: "SOURCE_EVIDENCE", evidence: "4/0", confidence: 100 }),
    ]));
    expect(draft.readinessScore).toMatchObject({
      customer: 100,
      contact: 100,
      product: 95,
      artwork: { status: "missing" },
    });
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("flags PVC grommets when the selected product tree has no matching option", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_pvc",
      productLabel: "PVC",
      sourceText: "PVC sign with grommets in the corners",
      finishingTexts: ["grommets in the corners"],
      treeJson: treeWithoutFinishingSupport(),
    });

    expect(draft.unsupportedRequestsJson).toEqual([
      expect.objectContaining({
        type: "UNSUPPORTED_REQUEST",
        requestedText: "grommets in the corners",
        category: "grommets",
        matchedProduct: "PVC",
        reason: "No compatible PBV2 option found.",
        severity: "review_required",
        suggestedAction: "Add manually or select a different product.",
      }),
    ]);
  });

  test("flags PVC grommets in corners when only generic grommet spacing choices exist", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_pvc",
      productLabel: "PVC",
      sourceText: "Please quote 3 signs, 24x36, printed double sided, 3mm white PVC, with grommets in the corners.",
      finishingTexts: ["grommets in the corners"],
      treeJson: finishingOptionTreeWithChoices({
        selectionKey: "grommet_placement",
        label: "Grommet Placement",
        choices: [
          { value: "none", label: "None" },
          { value: "every_2_feet", label: "Every 2 Feet" },
        ],
      }),
    });

    expect(draft.unsupportedRequestsJson).toEqual([
      expect.objectContaining({
        type: "UNSUPPORTED_REQUEST",
        requestedText: "grommets in the corners",
        category: "grommets",
        matchedProduct: "PVC",
        severity: "review_required",
        suggestedAction: "Add manually or select a different product.",
      }),
    ]);
    expect(draft.unsupportedRequestsJson[0].reason).toContain("only supports grommets choices: None, Every 2 Feet");
  });

  test("does not flag PVC grommets every 2 feet when matching spacing choice exists", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_pvc",
      productLabel: "PVC",
      sourceText: "PVC sign with grommets every 2 feet",
      finishingTexts: ["grommets every 2 feet"],
      treeJson: finishingOptionTreeWithChoices({
        selectionKey: "grommet_placement",
        label: "Grommet Placement",
        choices: [
          { value: "none", label: "None" },
          { value: "every_2_feet", label: "Every 2 Feet" },
        ],
      }),
    });

    expect(draft.unsupportedRequestsJson).toEqual([]);
  });

  test("flags PVC rounded corners when no corner-radius option exists", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_pvc",
      productLabel: "PVC",
      sourceText: "PVC sign with rounded corners",
      finishingTexts: ["rounded corners"],
      treeJson: treeWithoutFinishingSupport(),
    });

    expect(draft.unsupportedRequestsJson).toEqual([
      expect.objectContaining({
        requestedText: "rounded corners",
        category: "rounded_corners",
        matchedProduct: "PVC",
      }),
    ]);
  });

  test("flags rounded corners when corner option has no rounded-corner choice", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_pvc",
      productLabel: "PVC",
      sourceText: "PVC sign with rounded corners",
      finishingTexts: ["rounded corners"],
      treeJson: finishingOptionTreeWithChoices({
        selectionKey: "corner_radius",
        label: "Corner Radius",
        choices: [
          { value: "square", label: "Square Corners" },
        ],
      }),
    });

    expect(draft.unsupportedRequestsJson).toEqual([
      expect.objectContaining({
        requestedText: "rounded corners",
        category: "rounded_corners",
        matchedProduct: "PVC",
      }),
    ]);
    expect(draft.unsupportedRequestsJson[0].reason).toContain("only supports rounded corners choices: Square Corners");
  });

  test("does not flag banner pole pockets when the PBV2 tree supports them", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_banner",
      productLabel: "Banner",
      sourceText: "Banner with pole pockets",
      finishingTexts: ["pole pockets"],
      treeJson: finishingOptionTree({
        selectionKey: "pole_pockets",
        label: "Pole Pockets",
        choiceLabel: "Pole Pockets",
      }),
    });

    expect(draft.unsupportedRequestsJson).toEqual([]);
    expect(draft.reviewedLineItemsJson[0].pbv2OptionSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selectionKey: "pole_pockets",
        source: "source_evidence",
        origin: "SOURCE_EVIDENCE",
        evidence: "pole pockets",
      }),
    ]));
  });

  test("does not flag coroplast H-stakes when the PBV2 tree supports them", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_coroplast",
      productLabel: "Coroplast",
      sourceText: "Coroplast sign with H-stakes",
      finishingTexts: ["H-stakes"],
      treeJson: finishingOptionTree({
        selectionKey: "stakes",
        label: "Stakes",
        choiceLabel: "H-Stakes",
        choiceValue: "h_stakes",
      }),
    });

    expect(draft.unsupportedRequestsJson).toEqual([]);
    expect(draft.reviewedLineItemsJson[0].pbv2OptionSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selectionKey: "stakes",
        source: "source_evidence",
        origin: "SOURCE_EVIDENCE",
        evidence: "H-stakes",
      }),
    ]));
  });

  test("flags ACM drill holes when no drill-hole option exists", async () => {
    const draft = await buildDraftForUnsupportedRequestCase({
      productId: "product_acm",
      productLabel: "ACM",
      sourceText: "ACM sign with drill holes",
      finishingTexts: ["drill holes"],
      treeJson: treeWithoutFinishingSupport(),
    });

    expect(draft.unsupportedRequestsJson).toEqual([
      expect.objectContaining({
        requestedText: "drill holes",
        category: "drill_holes",
        matchedProduct: "ACM",
      }),
    ]);
  });

  test("leaves ambiguous customer matches unselected for staff review", async () => {
    const ambiguousDraft = parsedDraft({
      customer: {
        ...parsedDraft().customer,
        sourceEmail: null,
        candidateCustomerIds: [],
        candidateContactIds: [],
        customerCandidates: [],
        contactCandidates: [],
      },
    });
    const { repo } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: ambiguousDraft }));
    (repo.searchCustomers as any).mockImplementation(async (_organizationId: string, search: string | null) => {
      const value = String(search ?? "").toLowerCase();
      if (value.includes("brainstorm")) {
        return [
          { id: "customer_1", companyName: "Brainstorm Print", email: "billing@example.com", phone: null, status: "active" },
          { id: "customer_2", companyName: "Brainstorm Print West", email: "west@example.com", phone: null, status: "active" },
        ];
      }
      return [];
    });
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedCustomerJson.selectedCustomerId).toBeNull();
    expect(draft.reviewedCustomerJson.selectedCustomerSource).toBeNull();
    expect(draft.reviewedCustomerJson.selectedContactId).toBeNull();
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("backfills interpreted customer and contact on older unselected review drafts", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: {
          ...initialized.reviewedCustomerJson,
          selectedCustomerId: null,
          selectedCustomerSource: null,
          selectedCustomerReason: null,
          selectedCustomerConfidence: null,
          selectedContactId: null,
          selectedContactSource: null,
          selectedContactReason: null,
          selectedContactConfidence: null,
        },
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson,
        reviewedArtworkJson: initialized.reviewedArtworkJson,
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Older draft without interpreted selections",
      },
    });

    const backfilled = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(backfilled.reviewedCustomerJson).toMatchObject({
      selectedCustomerId: "customer_1",
      selectedCustomerSource: "crm_match",
      selectedCustomerConfidence: 94,
      selectedContactId: "contact_1",
      selectedContactSource: "crm_match",
      selectedContactConfidence: 100,
    });
    expect(repo.createReviewSnapshotWithEvent).toHaveBeenCalledTimes(3);
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test.each([
    ["4/0", "single"],
    ["1/0", "single"],
    ["4/1", "double"],
    ["4/4", "double"],
    ["1/1", "double"],
  ])("maps print notation %s deterministically for PBV2 sides", (_notation, expectedValue) => {
    const hydrated = hydrateInboundPbv2Selections(requiredPbv2Tree() as any, `PVC Signs Prints: ${_notation}`);

    expect(hydrated.selections.selected.sides).toMatchObject({
      value: expectedValue,
      note: "Source evidence",
      origin: "SOURCE_EVIDENCE",
      evidence: _notation,
    });
    expect(hydrated.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selectionKey: "sides",
        source: "deterministic_print_spec_rule",
        origin: "SOURCE_EVIDENCE",
        evidence: _notation,
        confidence: 100,
      }),
    ]));
  });

  test("source evidence single sided overrides a double-sided product default", () => {
    const tree = requiredPbv2Tree();
    (tree.nodes.sides.input as any).defaultValue = "double";

    const hydrated = hydrateInboundPbv2Selections(tree as any, "PVC Signs 24x36 single sided");

    expect(hydrated.selections.selected.sides).toMatchObject({
      value: "single",
      origin: "SOURCE_EVIDENCE",
      evidence: "single sided",
    });
    expect(hydrated.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selectionKey: "sides",
        choiceLabel: "Single Sided / 4/0",
        origin: "SOURCE_EVIDENCE",
        evidence: "single sided",
        conflictsWithDefault: true,
        defaultChoiceLabel: "Double Sided",
      }),
    ]));
    expect(hydrated.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ selectionKey: "sides", source: "product_default" }),
    ]));
  });

  test("does not label unmatched defaults as source evidence", () => {
    const hydrated = hydrateInboundPbv2Selections(requiredPbv2Tree() as any, "PVC Signs 24x36 single sided");

    expect(hydrated.selections.selected.contour_cutting).toMatchObject({
      value: "none",
      origin: "DEFAULT",
      evidence: null,
    });
    expect(hydrated.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selectionKey: "contour_cutting",
        source: "product_default",
        origin: "DEFAULT",
        evidence: null,
      }),
    ]));
    expect(hydrated.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ selectionKey: "contour_cutting", origin: "SOURCE_EVIDENCE" }),
    ]));
  });

  test("does not treat generated PBV2 choice identifiers as source evidence", () => {
    const tree = {
      schemaVersion: 2,
      rootNodeIds: ["finish"],
      nodes: {
        finish: {
          id: "finish",
          kind: "question",
          label: "Finish",
          input: { type: "select", required: false, selectionKey: "finish", defaultValue: "choice_1" },
          choices: [
            { value: "choice_1", label: "Matte" },
            { value: "choice_2", label: "Gloss" },
            { value: "choice_3", label: "Satin" },
          ],
        },
      },
    };

    const hydrated = hydrateInboundPbv2Selections(tree as any, "Please quote 3 aluminum signs, 24x36, printed single sided.");

    expect(hydrated.selections.selected.finish).toMatchObject({
      value: "choice_1",
      origin: "DEFAULT",
      evidence: null,
    });
    expect(hydrated.suggestions).toEqual([
      expect.objectContaining({
        selectionKey: "finish",
        value: "choice_1",
        choiceLabel: "Matte",
        source: "product_default",
        origin: "DEFAULT",
        evidence: null,
      }),
    ]);
    expect(hydrated.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "source_evidence" }),
    ]));
  });

  test("saves staff edits without creating downstream records", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: { ...initialized.reviewedCustomerJson, notes: "Confirmed by CSR" },
        reviewedOrderJson: { ...initialized.reviewedOrderJson, internalNotes: "Rush review" },
        reviewedLineItemsJson: [{ ...initialized.reviewedLineItemsJson[0], quantity: 4 }],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork will follow" })),
        warningsJson: initialized.warningsJson,
        reviewNotes: "Staff edited quantity",
      },
    });

    expect(saved.reviewedLineItemsJson[0].quantity).toBe(4);
    expect(saved.reviewedArtworkJson.status).toBe("to_follow");
    expect(saved.status).toBe("draft");
    expect(repo.createReviewSnapshotWithEvent).toHaveBeenCalledTimes(2);
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
    expect(repo.matchCustomerWithEvent).not.toHaveBeenCalled();
    expect(repo.matchLineItemProductWithEvent).not.toHaveBeenCalled();
  });

  test("validates required fields before marking ready", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      name: "InboundOrderReviewDraftValidationError",
      errors: expect.arrayContaining(["Line 1 needs artwork assignment or an explicit artwork-status decision."]),
    });
  });

  test("treats classified artwork assigned to a line item as the readiness source of truth", async () => {
    const { repo, getRecord } = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [{
          ...initialized.reviewedLineItemsJson[0],
          artworkLinks: [{
            fileId: "file_artwork_1",
            fileRecordId: "file_record_artwork_1",
            filename: "pvc-sign-artwork.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12345,
            role: "artwork",
            classification: "ARTWORK",
            source: "staff_selected",
            confidence: 100,
            reason: "Staff assigned classified artwork to this line item.",
          }],
        }],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "missing" },
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: [{
          code: "ARTWORK_MISSING",
          message: "Artwork missing for line item.",
          severity: "warning",
          fieldPath: "lineItems.0.artwork",
          acknowledged: false,
        }],
        reviewNotes: null,
      },
    });

    expect(saved.reviewedArtworkJson.status).toBe("supplied");
    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.artwork", status: "resolved" }),
    ]));
    expect(saved.warningsJson).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ARTWORK_MISSING" }),
    ]));

    const ready = await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(ready.status).toBe("ready_to_convert");
    expect(getRecord().status).toBe("ready");
  });

  test("resolves only the edited line item's stale parser quantity blocker", async () => {
    const base = parsedDraft();
    const missingQuantityDraft = parsedDraft({
      lineItems: [
        { ...base.lineItems[0], quantity: null },
        { ...base.lineItems[0], sourceText: "Second PVC sign", quantity: null },
      ],
      missingDecisions: [
        {
          field: "lineItems.0.quantity",
          label: "What quantity is needed?",
          reason: "No clear quantity was detected for this line item.",
          severity: "blocking",
        },
        {
          field: "lineItems.1.quantity",
          label: "What quantity is needed?",
          reason: "No clear quantity was detected for this line item.",
          severity: "blocking",
        },
      ],
    });
    const { repo } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: missingQuantityDraft }));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson.map((lineItem, index) => (
          index === 0 ? { ...lineItem, quantity: 1, quantitySource: "staff_selected" } : lineItem
        )),
        reviewedArtworkJson: initialized.reviewedArtworkJson,
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Staff confirmed the first line quantity.",
      },
    });

    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.quantity", status: "resolved" }),
      expect.objectContaining({ field: "lineItems.1.quantity", status: "still_blocking" }),
    ]));
    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining([
        "PVC: quantity is required.",
        "What quantity is needed?: resolve or acknowledge this blocking decision.",
      ]),
    });
  });

  test("staff-confirmed quantity clears a stale parser blocker and permits mark ready", async () => {
    const base = parsedDraft();
    const missingQuantityDraft = parsedDraft({
      lineItems: [{ ...base.lineItems[0], quantity: null }],
      missingDecisions: [{
        field: "lineItems.0.quantity",
        label: "What quantity is needed?",
        reason: "No clear quantity was detected for this line item.",
        severity: "blocking",
      }],
    });
    const { repo, getRecord } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: missingQuantityDraft }));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["PVC: quantity is required."]),
    });

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [{
          ...initialized.reviewedLineItemsJson[0],
          quantity: 1,
          quantitySource: "staff_selected",
        }],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Staff confirmed quantity from follow-up.",
      },
    });

    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.quantity", status: "resolved" }),
    ]));
    expect(saved.validationErrors).not.toEqual(expect.arrayContaining([
      expect.stringContaining("What quantity is needed?"),
    ]));

    const ready = await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(ready.status).toBe("ready_to_convert");
    expect(getRecord().status).toBe("ready");
  });

  test("staff-confirmed size clears a stale parser blocker and permits mark ready", async () => {
    const base = parsedDraft();
    const missingSizeDraft = parsedDraft({
      lineItems: [{ ...base.lineItems[0], width: null, height: null }],
      missingDecisions: [{
        field: "lineItems.0.dimensions",
        label: "What size stickers are needed?",
        reason: "No clear dimensions were detected for this line item.",
        severity: "blocking",
      }],
    });
    const { repo, getRecord } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: missingSizeDraft }));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["PVC: width and height are required for this product type."]),
    });

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [{
          ...initialized.reviewedLineItemsJson[0],
          width: 21,
          height: 13,
          dimensionsUnit: "in",
          dimensionsSource: "staff_selected",
        }],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Staff confirmed the finished size.",
      },
    });

    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.dimensions", status: "resolved" }),
    ]));
    expect(saved.validationErrors.join("\n")).not.toContain("What size stickers are needed?");

    const ready = await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(ready.status).toBe("ready_to_convert");
    expect(getRecord().status).toBe("ready");
  });

  test("keeps size blockers for active incomplete lines and makes removed-line size decisions obsolete", async () => {
    const base = parsedDraft();
    const multiLineDraft = parsedDraft({
      lineItems: [
        { ...base.lineItems[0], width: 21, height: 13 },
        { ...base.lineItems[0], sourceText: "Second PVC sign", width: null, height: null },
      ],
      missingDecisions: [
        {
          field: "lineItems.0.dimensions",
          label: "What size is needed for line item 1?",
          reason: "No clear dimensions were detected for this line item.",
          severity: "blocking",
        },
        {
          field: "lineItems.1.dimensions",
          label: "What size is needed for line item 2?",
          reason: "No clear dimensions were detected for this line item.",
          severity: "blocking",
        },
      ],
    });
    const { repo } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: multiLineDraft }));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(initialized.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.dimensions", status: "resolved" }),
      expect.objectContaining({ field: "lineItems.1.dimensions", status: "still_blocking" }),
    ]));
    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["PVC: width and height are required for this product type."]),
    });

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [initialized.reviewedLineItemsJson[0]],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Removed the incomplete second line item.",
      },
    });

    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.1.dimensions", status: "resolved", resolutionNote: "Obsolete: reviewed line item was removed." }),
    ]));
    expect(saved.validationErrors.join("\n")).not.toContain("line item 2");
    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).resolves.toMatchObject({ status: "ready_to_convert" });
  });

  test("does not clear a different line item's artwork blocker", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    const firstLine = {
      ...initialized.reviewedLineItemsJson[0],
      artworkLinks: [{
        fileId: "file_artwork_1",
        fileRecordId: "file_record_artwork_1",
        filename: "line-one-artwork.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12345,
        role: "artwork" as const,
        classification: "ARTWORK" as const,
        source: "staff_selected" as const,
        confidence: 100,
        reason: "Staff assigned classified artwork to line one.",
      }],
    };
    const secondLine = { ...initialized.reviewedLineItemsJson[0], sourceText: "Second PVC sign", artworkLinks: [] };
    const secondLineArtworkDecision = {
      ...initialized.missingDecisionsJson[0],
      field: "lineItems.1.artwork",
      label: "Is artwork supplied for line item 2?",
    };

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [firstLine, secondLine],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "missing" },
        missingDecisionsJson: [...initialized.missingDecisionsJson, secondLineArtworkDecision],
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.artwork", status: "resolved" }),
      expect.objectContaining({ field: "lineItems.1.artwork", status: "still_blocking" }),
    ]));
    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["Line 2 needs artwork assignment or an explicit artwork-status decision."]),
    });
  });

  test("marks decisions for a removed trailing line obsolete and allows the remaining complete line to become ready", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    const completeFirstLine = {
      ...initialized.reviewedLineItemsJson[0],
      artworkLinks: [{
        fileId: "file_artwork_1",
        fileRecordId: "file_record_artwork_1",
        filename: "line-one-artwork.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12345,
        role: "artwork" as const,
        classification: "ARTWORK" as const,
        source: "staff_selected" as const,
        confidence: 100,
        reason: "Staff assigned classified artwork to line one.",
      }],
    };
    const deletedLineDecision = {
      ...initialized.missingDecisionsJson[0],
      field: "lineItems.1.artwork",
      label: "Is artwork supplied for line item 2?",
      severity: "blocking" as const,
      status: "still_blocking" as const,
    };

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [completeFirstLine],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "missing" },
        missingDecisionsJson: [...initialized.missingDecisionsJson, deletedLineDecision],
        warningsJson: initialized.warningsJson,
        reviewNotes: "Removed the unnecessary second line item.",
      },
    });

    expect(saved.reviewedLineItemsJson).toHaveLength(1);
    expect(saved.missingDecisionsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "lineItems.0.artwork", status: "resolved" }),
      expect.objectContaining({
        field: "lineItems.1.artwork",
        status: "resolved",
        resolutionNote: "Obsolete: reviewed line item was removed.",
      }),
    ]));
    expect(saved.validationErrors.join("\n")).not.toContain("Line 2");

    const ready = await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(ready.status).toBe("ready_to_convert");
  });

  test("matching PO total and system total does not create a pricing warning", async () => {
    const attempt = parseAttempt({ parsedDraft: parsedDraftWithPoPricing({ totalPriceCents: 4500, evidenceText: "Total: $45.00" }) });
    const { repo } = makeRepository(inboundRecord(), attempt);
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      status: "matched",
      message: null,
      poPriceCents: 4500,
      systemPriceCents: 4500,
      differenceCents: 0,
    });
    expect(draft.validationErrors.join("\n")).not.toContain("PO price differs from system price");
  });

  test("hydrates system pricing for inbound lines even when no PO price was detected", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      systemPriceCents: 4500,
      systemUnitPriceCents: 1500,
      effectiveTotalCents: 4500,
      effectiveUnitPriceCents: 1500,
      priceOverrideMode: null,
    });
  });

  test("normalizes fixed PBV2 dimensions before pricing an inbound line", async () => {
    const { repo } = makeRepository();
    (repo.getProduct as jest.Mock).mockResolvedValue({
      id: "product_pvc",
      name: "PVC Signs",
      measurementMode: "dimensions_required",
      pricingProfileKey: "sheet",
    });
    (repo.getProductActivePbv2Tree as jest.Mock).mockResolvedValue({
      product: { id: "product_pvc", name: "PVC Signs", pbv2ActiveTreeVersionId: "tree_pvc" },
      activeTree: {
        id: "tree_pvc",
        treeJson: {
          schemaVersion: 2,
          rootNodeIds: [],
          nodes: {},
          meta: { fixedDimensions: { widthIn: 48, heightIn: 96 } },
        },
      },
    });
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(mockPriceLineItem).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      productId: "product_pvc",
      quantity: 3,
      widthIn: 48,
      heightIn: 96,
    }));
  });

  test("surfaces the actual system pricing failure reason", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(
      repo as any,
      undefined as any,
      async () => {
        throw new Error("sheet_consumption_sqft: piece 72x48 exceeds sheet 48x96 without rotation");
      },
    );

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0].pricingReviewJson?.message).toContain(
      "piece 72x48 exceeds sheet 48x96 without rotation",
    );
  });

  test("PO total mismatch blocks mark ready until staff resolves it", async () => {
    const attempt = parseAttempt({ parsedDraft: parsedDraftWithPoPricing({ totalPriceCents: 5000, evidenceText: "Total: $50.00" }) });
    const { repo } = makeRepository(inboundRecord(), attempt);
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(initialized.reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      status: "mismatch",
      message: "PO price differs from system price.",
      poPriceCents: 5000,
      systemPriceCents: 4500,
      differenceCents: -500,
      comparisonType: "total",
    });

    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson,
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork to follow" })),
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      name: "InboundOrderReviewDraftValidationError",
      errors: expect.arrayContaining(["PVC: PO price differs from system price. Acknowledge or resolve pricing before conversion."]),
    });
  });

  test("PO unit price mismatch is detected when no PO total is available", async () => {
    const attempt = parseAttempt({ parsedDraft: parsedDraftWithPoPricing({ unitPriceCents: 2000, evidenceText: "Unit Price: $20.00" }) });
    const { repo } = makeRepository(inboundRecord(), attempt);
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      status: "mismatch",
      comparisonType: "unit",
      poPriceCents: 2000,
      systemUnitPriceCents: 1500,
      differenceCents: -500,
    });
  });

  test("purchase order field extraction captures rush fees", () => {
    const summary = extractPurchaseOrderFields({
      text: "Purchase Order 151661\nQty: 3\nUnit Price: $15.00\nRush Fee: $25.00\nTotal: $70.00",
      sourceDocument: "PO_151661.pdf",
    });

    expect(summary.pricing).toMatchObject({
      unitPriceCents: 1500,
      rushFeesCents: 2500,
      totalPriceCents: 7000,
    });
    expect(summary.pricing?.evidenceText).toContain("Rush Fee: $25.00");
  });

  test("staff pricing acknowledgment unblocks mark ready", async () => {
    const attempt = parseAttempt({ parsedDraft: parsedDraftWithPoPricing({ totalPriceCents: 5000, evidenceText: "Total: $50.00" }) });
    const { repo, getRecord } = makeRepository(inboundRecord(), attempt);
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    const pricingReviewJson = {
      ...initialized.reviewedLineItemsJson[0].pricingReviewJson!,
      status: "resolved" as const,
      acknowledged: true,
      resolution: "accept_system_price" as const,
      resolutionNote: "CSR confirmed Titan pricing.",
    };

    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [{ ...initialized.reviewedLineItemsJson[0], pricingReviewJson }],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork to follow" })),
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    const ready = await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(ready.status).toBe("ready_to_convert");
    expect(ready.reviewedLineItemsJson[0].pricingReviewJson).toMatchObject({
      status: "resolved",
      acknowledged: true,
      resolution: "accept_system_price",
      resolutionNote: "CSR confirmed Titan pricing.",
    });
    expect(getRecord().status).toBe("ready");
  });

  test("marks ready after required decisions are acknowledged", async () => {
    const { repo, getRecord } = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson,
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork to follow" })),
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    const ready = await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(ready.status).toBe("ready_to_convert");
    expect(getRecord().status).toBe("ready");
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
  });

  test("blocks editing converted and rejected inbound records", async () => {
    const convertedService = new InboundOrderService(makeRepository(inboundRecord({ createdQuoteId: "quote_1" })).repo as any);
    await expect(convertedService.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toThrow("Converted inbound records cannot be edited");

    const rejectedService = new InboundOrderService(makeRepository(inboundRecord({ status: "terminal", reviewOutcome: "rejected" })).repo as any);
    await expect(rejectedService.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
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
          unresolvedCustomer: true,
          unresolvedContact: true,
          notes: null,
        },
        reviewedOrderJson: { intent: "unknown", poNumber: null, dueDate: null, priority: "normal", shipMethod: null, fulfillmentType: "unknown", internalNotes: null, customerNotes: null },
        reviewedLineItemsJson: [],
        reviewedArtworkJson: { status: "missing", refs: [], unassignedAttachments: [], notes: null },
        missingDecisionsJson: [],
        warningsJson: [],
        reviewNotes: null,
      },
    })).rejects.toThrow("Rejected inbound records must be reopened");
  });

  test("does not overwrite an existing staff draft when a newer parse is available", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: { ...initialized.reviewedCustomerJson, companyName: "Staff Edited Brainstorm" },
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson,
        reviewedArtworkJson: initialized.reviewedArtworkJson,
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Do not overwrite me",
      },
    });
    repo.setLatestParseAttempt(parseAttempt({
      id: "attempt_2",
      parsedDraft: parsedDraft({ customer: { ...parsedDraft().customer, companyName: "New Parse Brainstorm" } }),
      createdAt: new Date("2026-06-09T12:20:00.000Z"),
    }));

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedCustomerJson.companyName).toBe("Staff Edited Brainstorm");
    expect(draft.hasNewerParse).toBe(true);
    expect(draft.latestParseAttemptId).toBe("attempt_2");
    expect(repo.createReviewSnapshotWithEvent).toHaveBeenCalledTimes(2);
  });

  test("refreshes an existing staff draft from the latest parse only when explicitly requested", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: { ...initialized.reviewedCustomerJson, companyName: "Staff Edited Brainstorm" },
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson,
        reviewedArtworkJson: initialized.reviewedArtworkJson,
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: "Do not overwrite me",
      },
    });
    repo.setLatestParseAttempt(parseAttempt({
      id: "attempt_2",
      parsedDraft: parsedDraft({ customer: { ...parsedDraft().customer, companyName: "New Parse Brainstorm" } }),
      createdAt: new Date("2026-06-09T12:20:00.000Z"),
    }));

    const refreshed = await service.refreshReviewDraftFromLatestParse({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(refreshed.reviewedCustomerJson.companyName).toBe("New Parse Brainstorm");
    expect(refreshed.sourceParseAttemptId).toBe("attempt_2");
    expect(refreshed.hasNewerParse).toBe(false);
    expect(refreshed.initializedFromParse).toBe(true);
    expect(repo.createReviewSnapshotWithEvent).toHaveBeenCalledTimes(3);
    expect(repo.createReviewSnapshotWithEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        eventType: "review_draft.refreshed_from_latest_parse",
      }),
    }));
  });

  test("suggests clear artwork attachments and leaves ambiguous artwork unassigned", async () => {
    const clearFile = inboundFile({
      id: "file_clear",
      fileRecordId: "file_record_clear",
      sourceFilename: "pvc-sign-24x36-artwork.pdf",
    });
    const ambiguousFile = inboundFile({
      id: "file_ambiguous",
      fileRecordId: "file_record_ambiguous",
      sourceFilename: "artwork.pdf",
    });
    const { repo } = makeRepository();
    (repo.listFiles as any).mockResolvedValue([clearFile, ambiguousFile]);
    const service = new InboundOrderService(repo as any);

    const draft = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(draft.reviewedLineItemsJson[0].artworkLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileId: "file_clear",
        role: "artwork",
        source: "ai_suggested",
        confidence: expect.any(Number),
      }),
    ]));
    expect(draft.reviewedArtworkJson.unassignedAttachments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileId: "file_ambiguous",
        source: "unresolved",
      }),
    ]));
  });

  test("saves one-to-many and many-to-one artwork links in review draft JSON", async () => {
    const twoLineDraft = parsedDraft({
      lineItems: [
        parsedDraft().lineItems[0],
        {
          ...parsedDraft().lineItems[0],
          sourceText: "3 PVC Signs 24x36 3mm White PVC second set",
        },
      ],
      missingDecisions: [],
    });
    const { repo } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: twoLineDraft }));
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    const sharedLink = {
      fileId: "file_shared",
      fileRecordId: "file_record_shared",
      filename: "shared-art.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      role: "artwork" as const,
      source: "staff_selected" as const,
      confidence: 100,
      reason: "Staff selected artwork attachment for this line item.",
    };
    const secondLink = {
      ...sharedLink,
      fileId: "file_second",
      fileRecordId: "file_record_second",
      filename: "second-art.pdf",
    };

    const saved = await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson.map((lineItem, index) => ({
          ...lineItem,
          artworkLinks: (index === 0 ? [sharedLink, secondLink] : [sharedLink]) as any,
        })),
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, unassignedAttachments: [] },
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    expect(saved.reviewedLineItemsJson[0].artworkLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "file_shared", source: "staff_selected" }),
      expect.objectContaining({ fileId: "file_second", source: "staff_selected" }),
    ]));
    expect(saved.reviewedLineItemsJson[1].artworkLinks).toEqual([
      expect.objectContaining({ fileId: "file_shared", source: "staff_selected" }),
    ]);
  });

  test("staff-selected and staff-removed artwork links survive parse refresh", async () => {
    const twoLineDraft = parsedDraft({
      lineItems: [
        parsedDraft().lineItems[0],
        {
          ...parsedDraft().lineItems[0],
          sourceText: "Second PVC Signs 24x36 3mm White PVC",
        },
      ],
      missingDecisions: [],
    });
    const file = inboundFile({
      id: "file_refresh",
      fileRecordId: "file_record_refresh",
      sourceFilename: "pvc-sign-24x36-artwork.pdf",
    });
    const { repo } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: twoLineDraft }));
    (repo.listFiles as any).mockResolvedValue([file]);
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    const baseLink = {
      fileId: "file_refresh",
      fileRecordId: "file_record_refresh",
      filename: "pvc-sign-24x36-artwork.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      role: "artwork" as const,
      source: "staff_selected" as const,
      confidence: 100,
      reason: "Staff selected artwork attachment for this line item.",
    };
    const staffRemoved = {
      ...baseLink,
      source: "staff_removed" as const,
      confidence: 100,
      reason: "Staff removed artwork link from this line item.",
    };
    const staffSelected = {
      ...baseLink,
      source: "staff_selected" as const,
      confidence: 100,
      reason: "Staff selected artwork attachment for this line item.",
    };
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson.map((lineItem, index) => ({
          ...lineItem,
          artworkLinks: (index === 0 ? [staffRemoved] : [staffSelected]) as any,
        })),
        reviewedArtworkJson: initialized.reviewedArtworkJson,
        missingDecisionsJson: initialized.missingDecisionsJson,
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });
    repo.setLatestParseAttempt(parseAttempt({
      id: "attempt_2",
      parsedDraft: parsedDraft({
        ...twoLineDraft,
        order: { ...twoLineDraft.order, poNumber: "151662" },
      }),
      createdAt: new Date("2026-06-09T12:15:00.000Z"),
    }));

    const refreshed = await service.refreshReviewDraftFromLatestParse({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(refreshed.reviewedLineItemsJson[0].artworkLinks).toEqual([
      expect.objectContaining({ fileId: "file_refresh", source: "staff_removed" }),
    ]);
    expect(refreshed.reviewedLineItemsJson[1].artworkLinks).toEqual([
      expect.objectContaining({ fileId: "file_refresh", source: "staff_selected" }),
    ]);
    expect(refreshed.reviewedArtworkJson.unassignedAttachments).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "file_refresh" }),
    ]));
  });

  async function prepareReadyDraft(service: InboundOrderService, overrides: {
    lineItem?: Record<string, unknown>;
    order?: Record<string, unknown>;
    customer?: Record<string, unknown>;
    unsupportedRequests?: any[];
  } = {}) {
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: { ...initialized.reviewedCustomerJson, ...(overrides.customer ?? {}) },
        reviewedOrderJson: { ...initialized.reviewedOrderJson, ...(overrides.order ?? {}) },
        reviewedLineItemsJson: initialized.reviewedLineItemsJson.map((lineItem, index) => (
          index === 0 ? { ...lineItem, ...(overrides.lineItem ?? {}) } : lineItem
        )),
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork to follow" })),
        warningsJson: initialized.warningsJson,
        unsupportedRequestsJson: overrides.unsupportedRequests ?? initialized.unsupportedRequestsJson,
        reviewNotes: "Ready for order conversion",
      },
    });
    return service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
  }

  test("allows a draft quote with missing artwork and carries the warning in conversion metadata", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    (repo.createQuoteDraftFromInboundReview as jest.Mock).mockResolvedValue({
      quote: {
        id: "quote_missing_artwork",
        quoteNumber: 1004,
        status: "draft",
        totalPrice: "45.00",
        createdAt: new Date("2026-06-09T12:30:00.000Z"),
      },
      lineItems: [{ id: "quote_line_missing_artwork" }],
      skippedLineItems: [],
    });

    await service.createQuoteDraftFromInbound({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const conversionInput = (repo.createQuoteDraftFromInboundReview as jest.Mock).mock.calls[0][1];
    expect(conversionInput.conversionMetadata).toMatchObject({
      artworkStatus: "missing",
      artworkWarning: "Artwork is missing and remains required before production.",
    });
    expect(conversionInput.lineItems[0].snapshotJson).toMatchObject({
      inboundArtwork: {
        status: "missing",
        warning: "Artwork is missing and remains required before production.",
      },
    });
  });

  test("maps inbound quote provenance without copying source email into the list note", async () => {
    const sourceBody = "Please quote these signs. This full customer email must remain inbound-only.";
    const { repo } = makeRepository(inboundRecord({
      rawPayloadJson: {
        subject: "Sign quote",
        bodyText: sourceBody,
        sender: { name: "Shawn Fears", email: "shawn@example.com" },
      },
    }));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        artworkLinks: [{
          fileId: "file_artwork_1",
          fileRecordId: "file_record_artwork_1",
          filename: "pvc-sign-artwork.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12345,
          role: "artwork",
          source: "staff_selected",
          confidence: 100,
          reason: "Staff assigned artwork to this quote line item.",
        }],
      },
    });
    (repo.createQuoteDraftFromInboundReview as any).mockResolvedValue({
      quote: {
        id: "quote_1",
        quoteNumber: 1001,
        status: "draft",
        customerId: "customer_1",
        contactId: "contact_1",
        customerName: "Brainstorm Print",
        totalPrice: "0",
        createdAt: new Date("2026-06-09T12:30:00.000Z"),
      },
      lineItems: [{ id: "quote_line_1" }],
      skippedLineItems: [],
    });

    await service.createQuoteDraftFromInbound({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(repo.createQuoteDraftFromInboundReview).toHaveBeenCalledWith("org_1", expect.objectContaining({
      inboundRecordId: "inbound_1",
      listLabel: "Created from inbound review",
      conversionMetadata: expect.objectContaining({ inboundRecordId: "inbound_1" }),
    }));
    const conversionInput = (repo.createQuoteDraftFromInboundReview as any).mock.calls[0][1];
    expect(conversionInput.lineItems[0].artworkFileIds).toEqual(["file_artwork_1"]);
    expect(conversionInput.lineItems[0].pricing).toEqual(expect.objectContaining({
      lineTotalCents: 4500,
      pbv2TreeVersionId: "tree_pvc",
      optionSelectionsJson: expect.objectContaining({ schemaVersion: 2 }),
    }));
    expect(JSON.stringify(conversionInput)).not.toContain(sourceBody);
  });

  test("refresh preserves an explicitly staff-selected quantity", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        ...initialized,
        status: "draft",
        reviewedLineItemsJson: [{
          ...initialized.reviewedLineItemsJson[0],
          quantity: 7,
          quantitySource: "staff_selected",
        }],
      },
    });
    repo.setLatestParseAttempt(parseAttempt({
      id: "attempt_2",
      parsedDraft: parsedDraft({
        lineItems: [{ ...parsedDraft().lineItems[0], quantity: 1 }],
      }),
      createdAt: new Date("2026-06-09T12:20:00.000Z"),
    }));

    const staffPreserved = await service.refreshReviewDraftFromLatestParse({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(staffPreserved.reviewedLineItemsJson[0]).toMatchObject({
      quantity: 7,
      quantitySource: "staff_selected",
    });
  });

  test("prices every inbound print line before persisting a multi-line quote draft", async () => {
    const baseLine = parsedDraft().lineItems[0];
    const twoLineDraft = parsedDraft({
      lineItems: [
        baseLine,
        {
          ...baseLine,
          sourceText: "2 PVC Signs 48x24 3mm White PVC",
          quantity: 2,
          width: 48,
          height: 24,
        },
      ],
      missingDecisions: [],
    });
    const { repo } = makeRepository(inboundRecord(), parseAttempt({ parsedDraft: twoLineDraft }));
    mockPriceLineItem.mockImplementation(async ({ quantity }: any) => (
      pricingResult(quantity === 2 ? 7600 : 4500)
    ));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    await prepareReadyDraft(service);
    (repo.createQuoteDraftFromInboundReview as any).mockResolvedValue({
      quote: {
        id: "quote_multi",
        quoteNumber: 1002,
        status: "draft",
        totalPrice: "121.00",
        createdAt: new Date("2026-06-09T12:30:00.000Z"),
      },
      lineItems: [{ id: "quote_line_1" }, { id: "quote_line_2" }],
      skippedLineItems: [],
    });

    await service.createQuoteDraftFromInbound({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const conversionInput = (repo.createQuoteDraftFromInboundReview as any).mock.calls[0][1];
    expect(conversionInput.lineItems).toHaveLength(2);
    expect(conversionInput.lineItems.map((lineItem: any) => lineItem.pricing.lineTotalCents)).toEqual([4500, 7600]);
    expect(conversionInput.lineItems.every((lineItem: any) => (
      lineItem.pricing.pbv2SnapshotJson?.pricing?.totalCents === lineItem.pricing.lineTotalCents
    ))).toBe(true);
  });

  test("carries a reviewed total price override into quote conversion when system pricing is unavailable", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        pricingReviewJson: {
          priceOverrideMode: "override_total_after_margin",
          priceOverrideValueCents: 5000,
          priceOverrideSource: "staff",
        },
      },
    });
    mockPriceLineItem.mockRejectedValueOnce(new Error("Required product option is unavailable"));
    (repo.createQuoteDraftFromInboundReview as any).mockResolvedValue({
      quote: {
        id: "quote_override",
        quoteNumber: 1003,
        status: "draft",
        totalPrice: "50.00",
        createdAt: new Date("2026-06-09T12:30:00.000Z"),
      },
      lineItems: [{ id: "quote_line_override" }],
      skippedLineItems: [],
    });

    await service.createQuoteDraftFromInbound({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    const conversionInput = (repo.createQuoteDraftFromInboundReview as any).mock.calls[0][1];
    expect(conversionInput.lineItems[0].pricing).toMatchObject({
      calculatedLineTotalCents: 0,
      lineTotalCents: 5000,
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 5000,
      priceOverrideSource: "staff",
    });
  });

  test("blocks order conversion when inbound is not ready or draft is missing", async () => {
    const notReadyRepo = makeRepository().repo;
    const notReadyService = new InboundOrderService(notReadyRepo as any, makeOrderRepository() as any, mockPriceLineItem);

    await expect(notReadyService.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      name: "InboundOrderConversionValidationError",
      errors: expect.arrayContaining([
        "Inbound record must be ready before order conversion.",
        "Reviewed draft is missing.",
      ]),
    });

    const missingDraftRepo = makeRepository(inboundRecord({ status: "ready" })).repo;
    const missingDraftService = new InboundOrderService(missingDraftRepo as any, makeOrderRepository() as any, mockPriceLineItem);
    await expect(missingDraftService.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["Reviewed draft is missing."]),
    });
  });

  test("blocks marking an order draft ready when artwork is missing until staff selects the bypass", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any, makeOrderRepository() as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        ...initialized,
        status: "draft",
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "missing" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({
          ...decision,
          status: "acknowledged",
          resolutionNote: "Artwork has not been received.",
        })),
      },
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining([
        "Artwork is missing. Assign artwork or select Bypass artwork before marking the draft ready for order conversion.",
      ]),
    });
  });

  test("blocks order conversion when customer or line item data is missing", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: {
          sourceName: "Ada Lovelace",
          sourceEmail: "ada@example.com",
          sourcePhone: null,
          companyName: "Ada Signs",
          selectedCustomerId: null,
          selectedCustomerSource: null,
          selectedCustomerReason: null,
          selectedCustomerConfidence: null,
          selectedContactId: null,
          selectedContactSource: null,
          selectedContactReason: null,
          selectedContactConfidence: null,
          unresolvedCustomer: true,
          unresolvedContact: true,
          notes: null,
        },
        reviewedOrderJson: {
          intent: "unknown",
          poNumber: "PO-123",
          dueDate: "2026-06-20",
          priority: "normal",
          shipMethod: "Pickup",
          fulfillmentType: "pickup",
          internalNotes: null,
          customerNotes: null,
        },
        reviewedLineItemsJson: [{
          sourceLineItemId: null,
          sourceText: "3 PVC Signs",
          productName: "PVC Signs",
          selectedProductId: null,
          selectedProductSource: null,
          interpretedProductId: null,
          interpretedProductReason: null,
          interpretedProductConfidence: null,
          productUnresolved: true,
          quantity: null,
          quantitySource: null,
          width: 24,
          height: 36,
          dimensionsUnit: "in",
          dimensionsSource: "staff_selected",
          materialText: "3mm White PVC",
          materialSource: "staff_selected",
          printSpecs: [],
          printSpecsSource: null,
          optionTexts: [],
          optionTextsSource: null,
          finishingTexts: [],
          finishingTextsSource: null,
          optionSelectionsJson: null,
          pbv2TreeVersionId: null,
          pbv2OptionSuggestions: [],
          pricingReviewJson: null,
          artworkLinks: [],
          notes: null,
        }],
        reviewedArtworkJson: {
          status: "to_follow",
          refs: [],
          unassignedAttachments: [],
          notes: null,
        },
        missingDecisionsJson: [],
        warningsJson: [],
        reviewNotes: null,
      },
    });
    await service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    }).catch(() => undefined);

    await expect(service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining([
        "Select an existing customer, a contact, or both before creating a draft order.",
        "PVC Signs: select an existing product before order conversion.",
        "PVC Signs: quantity is required.",
      ]),
    });
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });

  test("mark ready blocks missing required PBV2 options", async () => {
    const { repo } = makeRepository();
    repo.getProductActivePbv2Tree.mockResolvedValue({
      product: { id: "product_pvc", name: "PVC", pbv2ActiveTreeVersionId: "tree_pvc" },
      activeTree: { id: "tree_pvc", treeJson: requiredPbv2Tree() },
    } as any);
    const service = new InboundOrderService(repo as any, makeOrderRepository() as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: initialized.reviewedLineItemsJson,
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "to_follow" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork to follow" })),
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["PVC requires Sides before conversion."]),
    });
  });

  test("conversion blocks when pricing cannot calculate a non-zero total", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
      },
    });
    mockPriceLineItem.mockResolvedValueOnce({
      pbv2TreeVersionId: "tree_pvc",
      lineTotalCents: 0,
      breakdown: { baseCents: 0, optionsCents: 0, totalCents: 0 },
      pbv2SnapshotJson: { pricingSystem: "pbv2", selectedOptions: [], pricing: { totalCents: 0 } },
    } as any);

    await expect(service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["PVC: system pricing is unavailable or zero. Enter a valid unit or total price override before conversion."]),
    });
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });

  test("carries a reviewed unit price override into draft order conversion", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
        pricingReviewJson: {
          priceOverrideMode: "override_unit_after_margin",
          priceOverrideValueCents: 2000,
          priceOverrideSource: "po",
        },
      },
    });
    mockPriceLineItem.mockRejectedValue(new Error("PBV2 price is unavailable"));

    await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({
      status: "new",
      lineItems: [expect.objectContaining({
        quantity: 3,
        unitPrice: 20,
        totalPrice: 60,
        priceOverrideMode: "override_unit_after_margin",
        priceOverrideValueCents: 2000,
        overridePriceCents: 6000,
        overrideReason: "Inbound PO price override",
      })],
    }));
  });

  test("allows an intentional artwork bypass while retaining the pending-artwork prepress signal", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
      },
    });

    await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({
      notesInternal: null,
      lineItems: [expect.objectContaining({
        requiresPrepress: true,
        specsJson: expect.objectContaining({
          inbound: expect.objectContaining({
            artworkStatus: "to_follow",
            artworkBypassed: true,
          }),
        }),
      })],
    }));
    expect(orderRepo.addOrderInternalNote).not.toHaveBeenCalled();
  });

  test("creates a draft order from a ready inbound review and marks inbound converted", async () => {
    const { repo, getRecord } = makeRepository();
    const orderRepo = makeOrderRepository();
    const artworkFiles = [
      inboundFile({ id: "file_artwork_1", fileRecordId: "file_record_artwork_1", sourceFilename: "pvc-sign-artwork.pdf" }),
      inboundFile({ id: "file_artwork_2", fileRecordId: "file_record_artwork_2", sourceFilename: "pvc-sign-artwork-back.pdf" }),
    ];
    (repo.listFiles as jest.Mock).mockResolvedValue(artworkFiles);
    (repo.updateFile as jest.Mock).mockImplementation(async ({ fileId, patch }: any) => ({
      ...artworkFiles.find((file) => file.id === fileId),
      ...patch,
    }));
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
        artworkLinks: [{
          fileId: "file_artwork_1",
          fileRecordId: "file_record_artwork_1",
          filename: "pvc-sign-artwork.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12345,
          role: "artwork",
          source: "staff_selected",
          confidence: 100,
          reason: "Staff selected artwork attachment for this line item.",
        }, {
          fileId: "file_artwork_2",
          fileRecordId: "file_record_artwork_2",
          filename: "pvc-sign-artwork-back.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12345,
          role: "artwork",
          source: "staff_selected",
          confidence: 100,
          reason: "Staff selected second artwork attachment for this line item.",
        }],
        artworkQuantityMode: "one_each_per_file",
      },
      order: {
        dueDate: "6/11",
      },
      unsupportedRequests: [{
        type: "UNSUPPORTED_REQUEST",
        requestedText: "grommets in the corners",
        category: "grommets",
        matchedProduct: "PVC",
        reason: "Customer requested grommets in the corners, but the selected product only supports grommet choices: None, Every 2 Feet.",
        severity: "review_required",
        suggestedAction: "Review manually before conversion.",
      }],
    });

    const result = await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.orderId).toBe("order_1");
    expect(result.orderNumber).toBe("1001");
    expect(result.order).toMatchObject({ organizationId: "org_1", state: "open" });
    expect(result.inbound.record.createdOrderId).toBe("order_1");
    expect(getRecord()).toMatchObject({
      status: "submitted",
      reviewOutcome: "order_created",
      createdOrderId: "order_1",
      matchedOrderId: "order_1",
      submittedByUserId: "user_1",
    });
    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({
      customerId: "customer_1",
      contactId: "contact_1",
      status: "new",
      notesInternal: null,
      lineItems: [expect.objectContaining({
        productId: "product_pvc",
        quantity: 3,
        width: 24,
        height: 36,
        totalPrice: 45,
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
        selectedOptions: [{ groupLabel: "Thickness", optionLabel: "3mm White PVC" }],
        workflowState: "new",
        requiresPrepress: false,
        requiresProofApproval: false,
        taxAmount: 3.15,
        isTaxableSnapshot: true,
        specsJson: expect.objectContaining({
          inbound: expect.objectContaining({
            artworkLinks: [expect.objectContaining({
              fileId: "file_artwork_1",
              source: "staff_selected",
            }), expect.objectContaining({
              fileId: "file_artwork_2",
              source: "staff_selected",
            })],
            artworkQuantityMode: "one_each_per_file",
            artworkFileCount: 2,
            unsupportedRequests: [expect.objectContaining({
              requestedText: "grommets in the corners",
              category: "grommets",
            })],
          }),
        }),
      })],
      taxRate: 0.07,
      taxAmount: 3.15,
      taxableSubtotal: 45,
      dueDate: "2026-06-11",
    }));
    expect(calculateAuthoritativeOrderTax).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      customerId: "customer_1",
      lines: [expect.objectContaining({ productId: "product_pvc", totalPrice: 45 })],
    }));
    expect(mockPriceLineItem).toHaveBeenCalledWith(expect.objectContaining({
      productId: "product_pvc",
      quantity: 3,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: completePbv2Selections().selected,
      pbv2TreeVersionIdOverride: "tree_pvc",
    }));
    expect(orderRepo.createOrderAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order_1",
      actionType: "order_created_from_inbound",
      note: "Order created from inbound draft.",
      metadata: expect.objectContaining({
        inboundRecordId: "inbound_1",
        inboundDraftId: "inbound_1",
        sourceType: "manual",
        sourceReference: "PO-123",
        resultingOrderId: "order_1",
      }),
    }));
    expect(repo.markInboundOrderConvertedToOrder).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order_1",
      actorUserId: "user_1",
    }));
    expect(orderRepo.createOrderAttachment).toHaveBeenCalledTimes(2);
    expect(orderRepo.createOrderAttachment).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderId: "order_1",
      orderLineItemId: "order_line_1",
      fileRecordId: "file_record_artwork_1",
      role: "artwork",
    }));
    expect(orderRepo.createOrderAttachment).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fileRecordId: "file_record_artwork_2",
      role: "artwork",
    }));
    expect(repo.updateFile).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "file_artwork_1",
      patch: { createdOrderAttachmentId: "order_attachment_file_record_artwork_1" },
    }));
  });

  test("converts a ready review addressed to an independent contact without inventing a customer", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      customer: {
        selectedCustomerId: null,
        selectedContactId: "contact_independent",
        unresolvedCustomer: false,
        sourceName: "Casey Contact",
        sourceEmail: "casey@example.com",
      },
    });

    await service.convertInboundReviewDraftToOrder({ organizationId: "org_1", inboundRecordId: "inbound_1", actorUserId: "user_1" });

    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({
      customerId: null,
      contactId: "contact_independent",
    }));
  });

  test("preserves the canonical tax-exempt result when converting an inbound review", async () => {
    (calculateAuthoritativeOrderTax as jest.Mock).mockResolvedValueOnce({
      totals: {
        taxRate: 0,
        taxAmount: 0,
        taxableSubtotal: 0,
        lineItemsWithTax: [{ taxAmount: 0, isTaxableSnapshot: false }],
      },
    });
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service);

    await service.convertInboundReviewDraftToOrder({ organizationId: "org_1", inboundRecordId: "inbound_1", actorUserId: "user_1" });

    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({
      taxRate: 0,
      taxAmount: 0,
      taxableSubtotal: 0,
      lineItems: [expect.objectContaining({ taxAmount: 0, isTaxableSnapshot: false })],
    }));
  });

  test("keeps a reviewer-entered internal note separate from inbound provenance", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: { optionSelectionsJson: completePbv2Selections(), pbv2TreeVersionId: "tree_pvc" },
      order: { internalNotes: "Call before production." },
    });

    await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({ notesInternal: null }));
    expect(orderRepo.addOrderInternalNote).toHaveBeenCalledWith({
      organizationId: "org_1",
      orderId: "order_1",
      userId: "user_1",
      noteText: "Call before production.",
    });
    expect(orderRepo.createOrderAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "order_created_from_inbound",
      metadata: expect.not.objectContaining({ rawBody: expect.anything(), parserDiagnostics: expect.anything() }),
    }));
  });

  test("creates an order from current draft values while advancing readiness internally", async () => {
    const { repo, getRecord } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: { optionSelectionsJson: completePbv2Selections(), pbv2TreeVersionId: "tree_pvc" },
    });
    const current = await service.getReviewDraft({ organizationId: "org_1", inboundRecordId: "inbound_1", actorUserId: "user_1" });

    const result = await service.createOrderFromReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        ...current,
        status: "draft",
        reviewedOrderJson: { ...current.reviewedOrderJson, poNumber: "PO-CURRENT" },
      },
    });

    expect(result.orderId).toBe("order_1");
    expect(orderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({ poNumber: "PO-CURRENT" }));
    expect(getRecord()).toMatchObject({ status: "submitted", createdOrderId: "order_1" });
  });

  test("materializes one explicitly both-sided artwork file as Front and Back", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const artwork = inboundFile({
      id: "file_artwork_both",
      fileRecordId: "file_record_artwork_both",
      sourceFilename: "double-sided-sign.pdf",
    });
    (repo.listFiles as jest.Mock).mockResolvedValue([artwork]);
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);

    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: {
          ...completePbv2Selections(),
          selected: { ...completePbv2Selections().selected, sides: { value: "double" } },
        },
        pbv2TreeVersionId: "tree_pvc",
        artworkLinks: [{
          fileId: artwork.id,
          fileRecordId: artwork.fileRecordId,
          filename: artwork.sourceFilename,
          mimeType: artwork.mimeType,
          sizeBytes: artwork.sizeBytes,
          role: "artwork",
          assignmentSide: "both",
          source: "staff_selected",
          confidence: 100,
          reason: "Staff selected the same artwork for front and back.",
        }],
      },
    });

    await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(orderRepo.createOrderAttachment).toHaveBeenCalledTimes(2);
    expect(orderRepo.createOrderAttachment).toHaveBeenNthCalledWith(1, expect.objectContaining({
      fileRecordId: "file_record_artwork_both",
      role: "artwork",
      side: "front",
    }));
    expect(orderRepo.createOrderAttachment).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fileRecordId: "file_record_artwork_both",
      role: "artwork",
      side: "back",
    }));
  });

  test("blocks a double-sided review line when Back artwork is not explicitly assigned", async () => {
    const { repo } = makeRepository();
    const service = new InboundOrderService(repo as any, makeOrderRepository() as any, mockPriceLineItem);
    const initialized = await service.getReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    await service.saveReviewDraft({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: {
        status: "draft",
        reviewedCustomerJson: initialized.reviewedCustomerJson,
        reviewedOrderJson: initialized.reviewedOrderJson,
        reviewedLineItemsJson: [{
          ...initialized.reviewedLineItemsJson[0],
          optionSelectionsJson: {
            ...completePbv2Selections(),
            selected: { ...completePbv2Selections().selected, sides: { value: "double" } },
          },
          pbv2TreeVersionId: "tree_pvc",
          artworkLinks: [{
            fileId: "file_artwork_front",
            fileRecordId: "file_record_artwork_front",
            filename: "front.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12345,
            role: "artwork",
            assignmentSide: "front",
            source: "staff_selected",
            confidence: 100,
            reason: "Staff assigned Front artwork.",
          }],
        }],
        reviewedArtworkJson: { ...initialized.reviewedArtworkJson, status: "supplied" },
        missingDecisionsJson: initialized.missingDecisionsJson.map((decision) => ({ ...decision, status: "acknowledged", resolutionNote: "Artwork reviewed" })),
        warningsJson: initialized.warningsJson,
        reviewNotes: null,
      },
    });

    await expect(service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["PVC: assign Back artwork or choose the same artwork for both sides."]),
    });
  });

  test("uses transaction-scoped repositories for draft order conversion when available", async () => {
    const { repo } = makeRepository();
    const baseOrderRepo = makeOrderRepository();
    const transactionalOrderRepo = makeOrderRepository({ order: { id: "order_tx" } });
    const tx = { transaction: jest.fn(async (callback: any) => callback(tx)) };
    (repo as any).transaction = jest.fn(async (callback: any) => callback(tx, repo));
    (baseOrderRepo as any).withExecutor = jest.fn(() => transactionalOrderRepo);
    const service = new InboundOrderService(repo as any, baseOrderRepo as any, mockPriceLineItem);

    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
      },
    });

    const result = await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.orderId).toBe("order_tx");
    expect((repo as any).transaction).toHaveBeenCalledTimes(1);
    expect((baseOrderRepo as any).withExecutor).toHaveBeenCalledWith(tx);
    expect(baseOrderRepo.createOrder).not.toHaveBeenCalled();
    expect(transactionalOrderRepo.createOrder).toHaveBeenCalledWith("org_1", expect.objectContaining({
      status: "new",
      lineItems: expect.any(Array),
    }));
  });

  test("does not mark inbound converted when transactional artwork materialization fails", async () => {
    const { repo, getRecord } = makeRepository();
    const orderRepo = makeOrderRepository();
    const artwork = inboundFile({
      id: "file_artwork_failure",
      fileRecordId: "file_record_artwork_failure",
      sourceFilename: "artwork.pdf",
    });
    (repo.listFiles as jest.Mock).mockResolvedValue([artwork]);
    (repo as any).transaction = jest.fn(async (callback: any) => callback({}, repo));
    (orderRepo as any).withExecutor = jest.fn(() => orderRepo);
    (orderRepo.createOrderAttachment as jest.Mock).mockRejectedValue(new Error("Attachment materialization failed"));
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
        artworkLinks: [{
          fileId: artwork.id,
          fileRecordId: artwork.fileRecordId,
          filename: artwork.sourceFilename,
          mimeType: artwork.mimeType,
          sizeBytes: artwork.sizeBytes,
          role: "artwork",
          source: "staff_selected",
          confidence: 100,
          reason: "Staff selected artwork attachment for this line item.",
        }],
      },
    });

    await expect(service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toThrow("Attachment materialization failed");

    expect((repo as any).transaction).toHaveBeenCalledTimes(1);
    expect(repo.markInboundOrderConvertedToOrder).not.toHaveBeenCalled();
    expect(repo.markInboundOrderConversionFailed).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      message: "Attachment materialization failed",
    }));
    expect(getRecord()).toMatchObject({
      createdOrderId: null,
      reviewOutcome: "order_conversion_failed",
    });
  });

  test("fails conversion when the durable inbound-to-order link is not persisted", async () => {
    const { repo, getRecord } = makeRepository();
    const orderRepo = makeOrderRepository();
    (repo as any).transaction = jest.fn(async (callback: any) => callback({}, repo));
    (orderRepo as any).withExecutor = jest.fn(() => orderRepo);
    (repo.markInboundOrderConvertedToOrder as jest.Mock).mockResolvedValueOnce(null);
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);
    await prepareReadyDraft(service, {
      lineItem: {
        optionSelectionsJson: completePbv2Selections(),
        pbv2TreeVersionId: "tree_pvc",
      },
    });

    await expect(service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toThrow("inbound conversion link could not be persisted");

    expect(orderRepo.createOrderAuditLog).not.toHaveBeenCalled();
    expect(repo.markInboundOrderConversionFailed).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
    }));
    expect(getRecord()).toMatchObject({
      createdOrderId: null,
      reviewOutcome: "order_conversion_failed",
    });
  });

  test("returns existing order on repeated conversion without creating a duplicate", async () => {
    const { repo } = makeRepository(inboundRecord({
      status: "submitted",
      createdOrderId: "order_1",
      submittedAt: new Date("2026-06-09T12:30:00.000Z"),
    }));
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);

    const result = await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.orderId).toBe("order_1");
    expect(result.orderNumber).toBe("1001");
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });

  test("combines attachment-only source records into the selected primary draft and requests reparse", async () => {
    const primary = inboundRecord({
      id: "inbound_primary",
      rawPayloadJson: { sender: { email: "ada@example.com" }, subject: "Banner order", bodyText: "Need banners" },
    });
    const child = inboundRecord({
      id: "inbound_artwork",
      rawPayloadJson: { sender: { email: "ada@example.com" }, subject: "Artwork files", bodyText: "Artwork attached" },
    });
    const { repo } = makeRepository(primary);
    (repo as any).getRecord.mockImplementation(async (_organizationId: string, recordId: string) => (
      recordId === child.id ? child : primary
    ));
    (repo as any).combineRecords = jest.fn(async () => primary);
    const service = new InboundOrderService(repo as any);

    const result = await service.combineInboundRecords({
      organizationId: "org_1",
      actorUserId: "user_1",
      recordIds: [primary.id, child.id],
      primaryRecordId: primary.id,
    });

    expect(result.combinedSourceCount).toBe(2);
    expect(result.reparseRecommended).toBe(true);
    expect((repo as any).combineRecords).toHaveBeenCalledWith(expect.objectContaining({
      primaryRecordId: primary.id,
      childRecordIds: [child.id],
      combinedSources: expect.arrayContaining([
        expect.objectContaining({ recordId: primary.id }),
        expect.objectContaining({ recordId: child.id }),
      ]),
    }));
  });

  test("does not combine converted or rejected source records", async () => {
    const converted = inboundRecord({ id: "inbound_converted", createdQuoteId: "quote_1" });
    const active = inboundRecord({ id: "inbound_active" });
    const { repo } = makeRepository(active);
    (repo as any).getRecord.mockImplementation(async (_organizationId: string, recordId: string) => (
      recordId === converted.id ? converted : active
    ));
    (repo as any).combineRecords = jest.fn();
    const service = new InboundOrderService(repo as any);

    await expect(service.combineInboundRecords({
      organizationId: "org_1",
      actorUserId: "user_1",
      recordIds: [active.id, converted.id],
      primaryRecordId: active.id,
    })).rejects.toBeInstanceOf(InboundOrderTransitionError);
    expect((repo as any).combineRecords).not.toHaveBeenCalled();
  });

  test("requires explicit confirmation before combining records matched to different customers", async () => {
    const primary = inboundRecord({ id: "inbound_primary", matchedCustomerId: "customer_1" });
    const otherCustomer = inboundRecord({ id: "inbound_other", matchedCustomerId: "customer_2" });
    const { repo } = makeRepository(primary);
    (repo as any).getRecord.mockImplementation(async (_organizationId: string, recordId: string) => (
      recordId === otherCustomer.id ? otherCustomer : primary
    ));
    (repo as any).combineRecords = jest.fn();
    const service = new InboundOrderService(repo as any);

    await expect(service.combineInboundRecords({
      organizationId: "org_1",
      actorUserId: "user_1",
      recordIds: [primary.id, otherCustomer.id],
      primaryRecordId: primary.id,
    })).rejects.toMatchObject({ statusCode: 409 });
    expect((repo as any).combineRecords).not.toHaveBeenCalled();
  });

  test("requires the record with the sole existing review draft to remain the parent", async () => {
    const attachmentOnly = inboundRecord({ id: "inbound_attachment_only" });
    const drafted = inboundRecord({ id: "inbound_drafted" });
    const { repo } = makeRepository(attachmentOnly);
    (repo as any).getRecord.mockImplementation(async (_organizationId: string, recordId: string) => (
      recordId === drafted.id ? drafted : attachmentOnly
    ));
    (repo as any).listReviewSnapshots.mockImplementation(async (_organizationId: string, recordId: string) => (
      recordId === drafted.id ? [{ id: "review_draft_1" }] : []
    ));
    (repo as any).combineRecords = jest.fn();
    const service = new InboundOrderService(repo as any);

    await expect(service.combineInboundRecords({
      organizationId: "org_1",
      actorUserId: "user_1",
      recordIds: [attachmentOnly.id, drafted.id],
      primaryRecordId: attachmentOnly.id,
    })).rejects.toMatchObject({ statusCode: 409 });
    expect((repo as any).combineRecords).not.toHaveBeenCalled();
  });

  test("attaches inbound artwork, PO, and reference files to an existing order without creating a duplicate", async () => {
    const record = inboundRecord({
      id: "inbound_attach",
      rawPayloadJson: { sender: { email: "ada@example.com" }, subject: "Revised art and PO", bodyText: "Please use the attached revised artwork." },
    });
    const { repo, getRecord } = makeRepository(record);
    (repo as any).listFiles.mockResolvedValue([
      { id: "file_art", inboundRecordId: record.id, fileRecordId: "canonical_art", sourceFilename: "revised-art.pdf", role: "artwork", mimeType: "application/pdf", sizeBytes: 120, checksum: "art", status: "available", metadataJson: {} },
      { id: "file_po", inboundRecordId: record.id, fileRecordId: "canonical_po", sourceFilename: "po.pdf", role: "po", mimeType: "application/pdf", sizeBytes: 80, checksum: "po", status: "available", metadataJson: {} },
      { id: "file_ref", inboundRecordId: record.id, fileRecordId: "canonical_ref", sourceFilename: "instructions.txt", role: "reference", mimeType: "text/plain", sizeBytes: 20, checksum: "ref", status: "available", metadataJson: {} },
      { id: "file_junk", inboundRecordId: record.id, fileRecordId: "canonical_junk", sourceFilename: "signature.png", role: "other", mimeType: "image/png", sizeBytes: 12, checksum: "junk", status: "available", metadataJson: { attachmentClassification: { classification: "IGNORE_INLINE", confidence: 100, reasons: [], source: "manual_override", breakdown: {} } } },
    ]);
    const orderRepo = makeOrderRepository();
    (orderRepo as any).listAllOrderAttachments = jest.fn(async () => []);
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);

    const result = await service.attachInboundRecordToOrder({
      organizationId: "org_1",
      inboundRecordId: record.id,
      orderId: "order_1",
      actorUserId: "user_1",
      includeMessageHistory: true,
      includeAttachments: true,
      includeParsedNotes: true,
      includeJunkAttachments: false,
      confirmCustomerMismatch: false,
      artworkAssignments: [{ fileId: "file_art", orderLineItemId: "order_line_1", side: "front" }],
    });

    expect(result.createdAttachmentIds).toHaveLength(3);
    expect(result.skippedAttachments).toEqual(expect.arrayContaining([{ fileId: "file_junk", reason: expect.stringContaining("Junk") }]));
    expect(orderRepo.createOrderAttachment).toHaveBeenCalledWith(expect.objectContaining({ fileRecordId: "canonical_art", orderLineItemId: "order_line_1", role: "artwork", side: "front", isPrimary: false }));
    expect(orderRepo.createOrderAttachment).toHaveBeenCalledWith(expect.objectContaining({ fileRecordId: "canonical_po", role: "customer_po" }));
    expect(orderRepo.createOrderAttachment).toHaveBeenCalledWith(expect.objectContaining({ fileRecordId: "canonical_ref", role: "reference" }));
    expect(orderRepo.createOrderAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actionType: "inbound_record_attached", metadata: expect.objectContaining({ inboundRecordId: record.id }) }));
    expect((repo as any).updateRecordWithEvent).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ reviewOutcome: "attached_to_order", status: "ignored" }) }));
    expect(getRecord().createdOrderId).toBeNull();
  });

  test("does not attach metadata-only artwork as a usable order file", async () => {
    const record = inboundRecord({ id: "inbound_metadata_art" });
    const { repo } = makeRepository(record);
    (repo as any).listFiles.mockResolvedValue([{
      id: "file_metadata_art",
      inboundRecordId: record.id,
      fileRecordId: null,
      sourceFilename: "customer-art.pdf",
      role: "artwork",
      mimeType: "application/pdf",
      sizeBytes: 120,
      checksum: null,
      status: "uploaded",
      providerAttachmentId: "provider_attachment_1",
      providerMessageId: "provider_message_1",
      metadataJson: { attachmentState: "metadata_only" },
    }]);
    const orderRepo = makeOrderRepository();
    (orderRepo as any).listAllOrderAttachments = jest.fn(async () => []);
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);

    const result = await service.attachInboundRecordToOrder({
      organizationId: "org_1",
      inboundRecordId: record.id,
      orderId: "order_1",
      actorUserId: "user_1",
      includeMessageHistory: false,
      includeAttachments: true,
      includeParsedNotes: false,
      includeJunkAttachments: false,
      confirmCustomerMismatch: false,
      artworkAssignments: [{ fileId: "file_metadata_art", orderLineItemId: "order_line_1", side: "front" }],
    });

    expect(orderRepo.createOrderAttachment).not.toHaveBeenCalled();
    expect(result.createdAttachmentIds).toEqual([]);
    expect(result.skippedAttachments).toEqual([{
      fileId: "file_metadata_art",
      reason: "Metadata-only attachment has no usable stored file.",
    }]);
  });

  test("requires confirmation before attaching an inbound record to an order with a different customer", async () => {
    const record = inboundRecord({ id: "inbound_customer_mismatch", matchedCustomerId: "customer_inbound" });
    const { repo } = makeRepository(record);
    const orderRepo = makeOrderRepository({ order: { customerId: "customer_order" } });
    const service = new InboundOrderService(repo as any, orderRepo as any, mockPriceLineItem);

    await expect(service.attachInboundRecordToOrder({
      organizationId: "org_1",
      inboundRecordId: record.id,
      orderId: "order_1",
      actorUserId: "user_1",
      includeMessageHistory: true,
      includeAttachments: true,
      includeParsedNotes: false,
      includeJunkAttachments: false,
      confirmCustomerMismatch: false,
      artworkAssignments: [],
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(orderRepo.createOrderAttachment).not.toHaveBeenCalled();
    expect(orderRepo.createOrderAuditLog).not.toHaveBeenCalled();
  });
});
