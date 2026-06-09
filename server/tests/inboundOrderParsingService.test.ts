import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { AiProviderUnavailableError, type AiProviderAdapter } from "../services/ai/providers/AiProviderAdapter";
import { InboundOrderParsingService } from "../services/inboundOrders/InboundOrderParsingService";
import { InboundOrderTransitionError } from "../services/inboundOrders/InboundOrderService";

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
});
