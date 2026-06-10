import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  InboundOrderReviewDraftValidationError,
  InboundOrderService,
  InboundOrderTransitionError,
} from "../services/inboundOrders/InboundOrderService";

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
    listWarnings: jest.fn(async () => []),
    listDecisionFlags: jest.fn(async () => []),
    listEvents: jest.fn(async () => []),
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
    getOrderById: jest.fn(async (_organizationId: string, orderId: string) => (
      orderId === createdOrder.id ? createdOrder : undefined
    )),
    createdOrder,
  };
}

describe("InboundOrderService editable review draft", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      productName: "PVC Signs",
      selectedProductId: "product_pvc",
      quantity: 3,
      width: 24,
      height: 36,
    });
    expect(snapshots[0].payloadJson.metadata.snapshotKind).toBe("editable_review_draft");
    expect(repo.createQuoteDraftFromInboundReview).not.toHaveBeenCalled();
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
      errors: expect.arrayContaining(["Is artwork supplied for this item?: acknowledge artwork status before marking ready."]),
    });
  });

  test("marks ready after required decisions are acknowledged", async () => {
    const { repo, getRecord } = makeRepository();
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
        reviewedCustomerJson: { sourceName: null, sourceEmail: null, sourcePhone: null, companyName: null, selectedCustomerId: null, selectedContactId: null, unresolvedCustomer: true, unresolvedContact: true, notes: null },
        reviewedOrderJson: { poNumber: null, dueDate: null, shipMethod: null, fulfillmentType: "unknown", internalNotes: null, customerNotes: null },
        reviewedLineItemsJson: [],
        reviewedArtworkJson: { status: "missing", refs: [], notes: null },
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

  async function prepareReadyDraft(service: InboundOrderService) {
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
        reviewNotes: "Ready for order conversion",
      },
    });
    return service.markReviewDraftReady({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
  }

  test("blocks order conversion when inbound is not ready or draft is missing", async () => {
    const notReadyRepo = makeRepository().repo;
    const notReadyService = new InboundOrderService(notReadyRepo as any, makeOrderRepository() as any);

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
    const missingDraftService = new InboundOrderService(missingDraftRepo as any, makeOrderRepository() as any);
    await expect(missingDraftService.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    })).rejects.toMatchObject({
      errors: expect.arrayContaining(["Reviewed draft is missing."]),
    });
  });

  test("blocks order conversion when customer or line item data is missing", async () => {
    const { repo } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any);
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
          selectedContactId: null,
          unresolvedCustomer: true,
          unresolvedContact: true,
          notes: null,
        },
        reviewedOrderJson: {
          poNumber: "PO-123",
          dueDate: "2026-06-20",
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
          productUnresolved: true,
          quantity: null,
          width: 24,
          height: 36,
          dimensionsUnit: "in",
          materialText: "3mm White PVC",
          printSpecs: [],
          optionTexts: [],
          finishingTexts: [],
          notes: null,
        }],
        reviewedArtworkJson: {
          status: "to_follow",
          refs: [],
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
        "Select an existing customer before creating a draft order.",
        "PVC Signs: select an existing product before order conversion.",
        "PVC Signs: quantity is required.",
      ]),
    });
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });

  test("creates a draft order from a ready inbound review and marks inbound converted", async () => {
    const { repo, getRecord } = makeRepository();
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any);
    await prepareReadyDraft(service);

    const result = await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.orderId).toBe("order_1");
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
      lineItems: [expect.objectContaining({
        productId: "product_pvc",
        quantity: 3,
        width: 24,
        height: 36,
        workflowState: "new",
        requiresPrepress: false,
        requiresProofApproval: false,
      })],
    }));
    expect(repo.markInboundOrderConvertedToOrder).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order_1",
      actorUserId: "user_1",
    }));
  });

  test("returns existing order on repeated conversion without creating a duplicate", async () => {
    const { repo } = makeRepository(inboundRecord({
      status: "submitted",
      createdOrderId: "order_1",
      submittedAt: new Date("2026-06-09T12:30:00.000Z"),
    }));
    const orderRepo = makeOrderRepository();
    const service = new InboundOrderService(repo as any, orderRepo as any);

    const result = await service.convertInboundReviewDraftToOrder({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.orderId).toBe("order_1");
    expect(orderRepo.createOrder).not.toHaveBeenCalled();
  });
});
