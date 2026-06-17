import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

import { registerInboundOrderRoutes } from "../routes/inboundOrders.routes";
import {
  InboundEmailIngestionError,
} from "../services/inboundEmailIngestionService";
import {
  InboundOrderConversionValidationError,
  InboundOrderReviewDraftValidationError,
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

function inboundEvent(overrides: Record<string, any> = {}) {
  return {
    id: "event_1",
    organizationId: "org_1",
    inboundRecordId: "inbound_1",
    actorUserId: "user_1",
    actorType: "user",
    eventType: "record.received",
    fromStatus: null,
    toStatus: "needs_review",
    message: "Manual TEMP_INBOUND record created for review",
    metadataJson: { intakeState: "TEMP_INBOUND" },
    createdAt: new Date("2026-06-09T12:00:00.000Z"),
    ...overrides,
  };
}

function inboundDetail(record = inboundRecord()) {
  return {
    record,
    source: null,
    lineItems: [],
    files: [],
    warnings: [],
    decisionFlags: [],
    events: [inboundEvent({ inboundRecordId: record.id })],
    reviewSnapshots: [],
    latestReviewSnapshot: null,
    linkedQuote: null,
    quoteActivity: {
      syncStatus: "quote_missing",
      lastQuoteUpdatedAt: null,
      currentQuoteStatus: null,
      originalQuoteStatus: null,
      divergedFromReviewSnapshot: false,
      divergenceReasons: [],
      lastSyncEventAt: null,
    },
    matchedCustomer: null,
    matchedContact: null,
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
    parsedDraft: null,
    confidence: 88,
    warnings: [],
    errors: [],
    createdAt: new Date("2026-06-09T12:01:00.000Z"),
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
      candidateCustomerIds: ["customer_1"],
      candidateContactIds: ["contact_1"],
      customerCandidates: [{ id: "customer_1", label: "Ada Signs", confidence: 90, reason: "Matched name", metadata: {} }],
      contactCandidates: [{ id: "contact_1", label: "Ada Lovelace", confidence: 92, reason: "Matched email", metadata: {} }],
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
      candidateProductIds: ["product_1"],
      productCandidates: [{ id: "product_1", label: "Vinyl Banner", confidence: 78, reason: "Matched product", metadata: {} }],
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

function reviewDraft(overrides: Record<string, any> = {}) {
  return {
    id: "snapshot_1",
    snapshotId: "snapshot_1",
    snapshotVersion: 1,
    inboundOrderRecordId: "inbound_1",
    organizationId: "org_1",
    sourceParseAttemptId: "attempt_1",
    sourceParseAttemptCreatedAt: "2026-06-09T12:01:00.000Z",
    latestParseAttemptId: "attempt_1",
    latestParseAttemptCreatedAt: "2026-06-09T12:01:00.000Z",
    hasNewerParse: false,
    initializedFromParse: false,
    status: "draft",
    reviewedCustomerJson: {
      sourceName: "Shawn Fears",
      sourceEmail: "shawn@example.com",
      sourcePhone: null,
      companyName: "Brainstorm Print",
      selectedCustomerId: "customer_1",
      selectedCustomerSource: "interpreted_customer_match",
      selectedCustomerReason: "Matched by company name.",
      selectedCustomerConfidence: 92,
      selectedContactId: "contact_1",
      selectedContactSource: "interpreted_contact_match",
      selectedContactReason: "Matched by email.",
      selectedContactConfidence: 100,
      unresolvedCustomer: false,
      unresolvedContact: false,
      notes: null,
    },
    reviewedOrderJson: {
      poNumber: "151661",
      dueDate: "2026-06-11",
      shipMethod: null,
      fulfillmentType: "unknown",
      internalNotes: null,
      customerNotes: null,
    },
    reviewedLineItemsJson: [{
      sourceLineItemId: null,
      sourceText: "3 PVC Signs 24x36",
      productName: "PVC Signs",
      selectedProductId: "product_pvc",
      productUnresolved: false,
      quantity: 3,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      materialText: "3mm White PVC",
      printSpecs: [],
      optionTexts: [],
      finishingTexts: [],
      notes: null,
    }],
    reviewedArtworkJson: { status: "missing", refs: [], notes: null },
    missingDecisionsJson: [{
      field: "lineItems.0.artwork",
      label: "Is artwork supplied for this item?",
      reason: "No artwork file or artwork reference was detected.",
      severity: "warning",
      status: "still_blocking",
      resolutionNote: null,
    }],
    warningsJson: [],
    reviewNotes: null,
    createdByUserId: "user_1",
    updatedByUserId: "user_1",
    createdAt: "2026-06-09T12:02:00.000Z",
    updatedAt: "2026-06-09T12:02:00.000Z",
    validationErrors: ["Is artwork supplied for this item?: acknowledge artwork status before marking ready."],
    readinessScore: {
      overall: 92,
      customer: 100,
      contact: 100,
      product: 95,
      options: 90,
      artwork: { score: 60, status: "missing", label: "Missing" },
    },
    interpretationConfidence: {
      overall: 92,
      product: 95,
      options: 90,
    },
    ...overrides,
  };
}

function buildApp(
  service: Record<string, any>,
  options: {
    orgId?: string;
    internal?: boolean;
    parsingService?: Record<string, any>;
    inboundEmailIntakeSettingsService?: Record<string, any>;
    inboundEmailIngestionService?: Record<string, any>;
    inboundEmailMailboxSettingsService?: Record<string, any>;
    userRole?: string;
  } = {},
) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "staff@example.com", role: options.userRole ?? "admin" };
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = options.orgId ?? "org_1";
    next();
  };
  const assertInternalUser = (_req: any, res: any) => {
    if (options.internal === false) {
      res.status(403).json({ message: "Internal access required" });
      return false;
    }
    return true;
  };

  registerInboundOrderRoutes(app, {
    isAuthenticated,
    tenantContext,
    assertInternalUser,
    inboundOrderService: service as any,
    inboundOrderParsingService: options.parsingService as any,
    inboundEmailIntakeSettingsService: options.inboundEmailIntakeSettingsService as any,
    inboundEmailIngestionService: options.inboundEmailIngestionService as any,
    inboundEmailMailboxSettingsService: options.inboundEmailMailboxSettingsService as any,
  });
  return app;
}

describe("inbound order routes", () => {
  const service = {
    listInboundOrders: jest.fn<(...args: any[]) => Promise<any>>(),
    getInboundOrder: jest.fn<(...args: any[]) => Promise<any>>(),
    createManualInboundOrder: jest.fn<(...args: any[]) => Promise<any>>(),
    createManualRecord: jest.fn<(...args: any[]) => Promise<any>>(),
    updateInboundOrderStatus: jest.fn<(...args: any[]) => Promise<any>>(),
    searchCustomers: jest.fn(),
    searchCustomerContacts: jest.fn(),
    getProductOptionsForReview: jest.fn<(...args: any[]) => Promise<any>>(),
    applyReviewAction: jest.fn(),
    saveReviewSnapshot: jest.fn(),
    getQuoteDraftPreview: jest.fn(),
    matchCustomer: jest.fn(),
    matchLineItemProduct: jest.fn(),
    resolveWarning: jest.fn(),
    resolveDecisionFlag: jest.fn(),
    convertInboundReviewDraftToOrder: jest.fn<(...args: any[]) => Promise<any>>(),
    createQuoteDraftFromInbound: jest.fn(),
    getReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    saveReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    markReviewDraftReady: jest.fn<(...args: any[]) => Promise<any>>(),
    reopenReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    refreshReviewDraftFromLatestParse: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const parsingService = {
    parseInboundOrderRecord: jest.fn<(...args: any[]) => Promise<any>>(),
    listParseAttempts: jest.fn<(...args: any[]) => Promise<any>>(),
    getDraftPreview: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const inboundEmailIntakeSettingsService = {
    getSettings: jest.fn<(...args: any[]) => Promise<any>>(),
    getPullGuard: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const inboundEmailIngestionService = {
    pullLatestEmails: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const inboundEmailMailboxSettingsService = {
    listMailboxes: jest.fn<(...args: any[]) => Promise<any>>(),
    updateMailboxEnabled: jest.fn<(...args: any[]) => Promise<any>>(),
    setDefaultMailbox: jest.fn<(...args: any[]) => Promise<any>>(),
    deleteMailbox: jest.fn<(...args: any[]) => Promise<any>>(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns inbound email intake feature settings", async () => {
    inboundEmailIntakeSettingsService.getSettings.mockResolvedValue({
      inboundEmailIntakeEnabled: false,
      inboundEmailPullPaused: false,
    });

    const response = await request(buildApp(service, { inboundEmailIntakeSettingsService }))
      .get("/api/inbound-orders/email-settings");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        inboundEmailIntakeEnabled: false,
        inboundEmailPullPaused: false,
      },
    });
    expect(inboundEmailIntakeSettingsService.getSettings).toHaveBeenCalledWith("org_1");
  });

  test("manual email pull fails safely when inbound email intake is disabled", async () => {
    inboundEmailIntakeSettingsService.getPullGuard.mockResolvedValue({
      allowed: false,
      reason: "disabled",
      message: "Inbound email intake is disabled for this organization.",
      settings: {
        inboundEmailIntakeEnabled: false,
        inboundEmailPullPaused: false,
      },
    });

    const response = await request(buildApp(service, { inboundEmailIntakeSettingsService }))
      .post("/api/inbound-orders/email/pull-latest")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "INBOUND_EMAIL_INTAKE_DISABLED",
      message: "Inbound email intake is disabled for this organization.",
    });
  });

  test("manual email pull fails safely when inbound email pulling is paused", async () => {
    inboundEmailIntakeSettingsService.getPullGuard.mockResolvedValue({
      allowed: false,
      reason: "paused",
      message: "Inbound email pulling is paused for this organization.",
      settings: {
        inboundEmailIntakeEnabled: true,
        inboundEmailPullPaused: true,
      },
    });

    const response = await request(buildApp(service, { inboundEmailIntakeSettingsService }))
      .post("/api/inbound-orders/email/pull-latest")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "INBOUND_EMAIL_PULL_PAUSED",
      message: "Inbound email pulling is paused for this organization.",
    });
  });

  test("manual email pull reports missing inbound mailbox configuration", async () => {
    inboundEmailIntakeSettingsService.getPullGuard.mockResolvedValue({
      allowed: true,
      settings: {
        inboundEmailIntakeEnabled: true,
        inboundEmailPullPaused: false,
      },
    });
    inboundEmailIngestionService.pullLatestEmails.mockRejectedValue(new InboundEmailIngestionError(
      "INBOUND_EMAIL_MAILBOX_NOT_CONFIGURED",
      "No enabled inbound mailbox is configured for this organization.",
      409,
    ));

    const response = await request(buildApp(service, { inboundEmailIntakeSettingsService, inboundEmailIngestionService }))
      .post("/api/inbound-orders/email/pull-latest")
      .send({ limit: 10 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "INBOUND_EMAIL_MAILBOX_NOT_CONFIGURED",
      message: "No enabled inbound mailbox is configured for this organization.",
    });
  });

  test("manual email pull returns candidate creation summary", async () => {
    inboundEmailIntakeSettingsService.getPullGuard.mockResolvedValue({
      allowed: true,
      settings: {
        inboundEmailIntakeEnabled: true,
        inboundEmailPullPaused: false,
      },
    });
    inboundEmailIngestionService.pullLatestEmails.mockResolvedValue({
      summary: { created: 2, skippedDuplicates: 1, ignored: 3, failed: 0 },
      createdRecordIds: ["inbound_quote", "inbound_order"],
      mailboxResults: [{
        mailboxId: "mailbox_1",
        mailboxName: "Orders Inbox",
        provider: "gmail",
        created: 2,
        skippedDuplicates: 1,
        ignored: 3,
        failed: 0,
        error: null,
      }],
    });

    const response = await request(buildApp(service, { inboundEmailIntakeSettingsService, inboundEmailIngestionService }))
      .post("/api/inbound-orders/email/pull-latest")
      .send({ limit: 7 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        summary: { created: 2, skippedDuplicates: 1, ignored: 3, failed: 0 },
        createdRecordIds: ["inbound_quote", "inbound_order"],
      },
    });
    expect(inboundEmailIngestionService.pullLatestEmails).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      limit: 7,
    });
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
  });

  test("lists no configured inbound email mailboxes", async () => {
    inboundEmailMailboxSettingsService.listMailboxes.mockResolvedValue([]);

    const response = await request(buildApp(service, { inboundEmailMailboxSettingsService }))
      .get("/api/inbound-orders/email/mailboxes");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { mailboxes: [] },
    });
    expect(inboundEmailMailboxSettingsService.listMailboxes).toHaveBeenCalledWith("org_1");
  });

  test("lists a disabled inbound email mailbox", async () => {
    inboundEmailMailboxSettingsService.listMailboxes.mockResolvedValue([{
      id: "mailbox_disabled",
      provider: "gmail",
      name: "Orders Inbox",
      emailAddress: "orders@example.com",
      enabled: false,
      isDefault: true,
      lastPulledAt: null,
      lastPullStatus: null,
      lastPullError: null,
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z",
      authJson: { refreshToken: "secret_refresh_token" },
      refreshToken: "secret_refresh_token",
    }]);

    const response = await request(buildApp(service, { inboundEmailMailboxSettingsService }))
      .get("/api/inbound-orders/email/mailboxes");

    expect(response.status).toBe(200);
    expect(response.body.data.mailboxes[0]).toMatchObject({
      id: "mailbox_disabled",
      provider: "gmail",
      emailAddress: "orders@example.com",
      enabled: false,
      isDefault: true,
    });
  });

  test("lists an enabled inbound email mailbox", async () => {
    inboundEmailMailboxSettingsService.listMailboxes.mockResolvedValue([{
      id: "mailbox_enabled",
      provider: "gmail",
      name: "Quotes Inbox",
      emailAddress: "quotes@example.com",
      enabled: true,
      isDefault: false,
      lastPulledAt: "2026-06-09T12:05:00.000Z",
      lastPullStatus: "success",
      lastPullError: null,
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:05:00.000Z",
    }]);

    const response = await request(buildApp(service, { inboundEmailMailboxSettingsService }))
      .get("/api/inbound-orders/email/mailboxes");

    expect(response.status).toBe(200);
    expect(response.body.data.mailboxes[0]).toMatchObject({
      id: "mailbox_enabled",
      provider: "gmail",
      emailAddress: "quotes@example.com",
      enabled: true,
      isDefault: false,
      lastPullStatus: "success",
    });
  });

  test("redacts inbound mailbox auth data from list responses", async () => {
    inboundEmailMailboxSettingsService.listMailboxes.mockResolvedValue([{
      id: "mailbox_safe",
      provider: "gmail",
      name: "Safe Inbox",
      emailAddress: "safe@example.com",
      enabled: true,
      isDefault: true,
      lastPulledAt: null,
      lastPullStatus: null,
      lastPullError: null,
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z",
    }]);

    const response = await request(buildApp(service, { inboundEmailMailboxSettingsService }))
      .get("/api/inbound-orders/email/mailboxes");

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("authJson");
    expect(serialized).not.toContain("refreshToken");
    expect(serialized).not.toContain("secret_refresh_token");
  });

  test("creates a manual TEMP inbound record with needs_review status", async () => {
    const record = inboundRecord();
    const event = inboundEvent();
    service.createManualInboundOrder.mockResolvedValue({ record, event });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/manual")
      .send({
        reference: "PO-123",
        senderName: "Ada Lovelace",
        senderEmail: "ada@example.com",
        subject: "Need banners",
        bodyText: "Please make two banners.",
        notes: "Counter intake",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.record.status).toBe("needs_review");
    expect(service.createManualInboundOrder).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      actorUserId: "user_1",
      reference: "PO-123",
      bodyText: "Please make two banners.",
    }));
  });

  test("rejects manual intake without body text", async () => {
    const response = await request(buildApp(service))
      .post("/api/inbound-orders/manual")
      .send({ reference: "PO-123" });

    expect(response.status).toBe(400);
    expect(service.createManualInboundOrder).not.toHaveBeenCalled();
  });

  test("lists inbound records with org-scoped filters and counts", async () => {
    service.listInboundOrders.mockResolvedValue({
      records: [inboundRecord()],
      summary: {
        needsReview: 1,
        waitingOnCustomer: 0,
        readyReviewed: 0,
        convertedSubmitted: 0,
        rejectedTerminal: 0,
        withWarnings: 0,
      },
    });

    const response = await request(buildApp(service, { orgId: "org_2" }))
      .get("/api/inbound-orders?statusGroup=needs_review&sourceType=manual&search=banners");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.summary.needsReview).toBe(1);
    expect(service.listInboundOrders).toHaveBeenCalledWith({
      organizationId: "org_2",
      filters: expect.objectContaining({
        statusGroup: "needs_review",
        sourceType: "manual",
        search: "banners",
      }),
    });
  });

  test("gets an inbound record detail", async () => {
    service.getInboundOrder.mockResolvedValue(inboundDetail());

    const response = await request(buildApp(service)).get("/api/inbound-orders/inbound_1");

    expect(response.status).toBe(200);
    expect(response.body.data.record.id).toBe("inbound_1");
    expect(service.getInboundOrder).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
    });
  });

  test("returns safe JSON when record is not found", async () => {
    service.getInboundOrder.mockResolvedValue(null);

    const response = await request(buildApp(service)).get("/api/inbound-orders/missing");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Inbound order record not found");
  });

  test("updates status through review-only status endpoint", async () => {
    const updatedRecord = inboundRecord({ status: "waiting_on_customer" });
    service.updateInboundOrderStatus.mockResolvedValue(inboundDetail(updatedRecord));

    const response = await request(buildApp(service))
      .patch("/api/inbound-orders/inbound_1/status")
      .send({ status: "waiting" });

    expect(response.status).toBe(200);
    expect(response.body.data.record.status).toBe("waiting_on_customer");
    expect(service.updateInboundOrderStatus).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      status: "waiting_on_customer",
    });
  });

  test("rejects an inbound record through the auditable review action route", async () => {
    const rejectedRecord = inboundRecord({
      status: "terminal",
      reviewOutcome: "rejected",
      rejectionReason: "Spam",
      rejectedByUserId: "user_1",
      rejectedAt: new Date("2026-06-09T12:05:00.000Z"),
    });
    (service.applyReviewAction as any).mockResolvedValue(inboundDetail(rejectedRecord));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/reject")
      .send({ reason: "Spam" });

    expect(response.status).toBe(200);
    expect(response.body.data.record.status).toBe("terminal");
    expect(response.body.data.record.rejectionReason).toBe("Spam");
    expect(service.applyReviewAction).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      action: "reject",
      note: "Spam",
    });
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("searches customers and all contacts for review selectors", async () => {
    (service.searchCustomers as any).mockResolvedValue([{
      id: "customer_1",
      companyName: "Ada Signs",
      email: "billing@adasigns.test",
      phone: "555-0101",
      status: "active",
    }]);
    (service.searchCustomerContacts as any).mockResolvedValue([{
      id: "contact_1",
      customerId: "customer_1",
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@adasigns.test",
      phone: "555-0102",
      mobile: null,
      isPrimary: true,
    }]);

    const customerResponse = await request(buildApp(service))
      .get("/api/inbound-orders/customer-search?search=Ada");
    const contactResponse = await request(buildApp(service))
      .get("/api/inbound-orders/contact-search?search=ada");

    expect(customerResponse.status).toBe(200);
    expect(customerResponse.body.data[0].companyName).toBe("Ada Signs");
    expect(contactResponse.status).toBe(200);
    expect(contactResponse.body.data[0].name).toBe("Ada Lovelace");
    expect(service.searchCustomerContacts).toHaveBeenCalledWith({
      organizationId: "org_1",
      customerId: null,
      search: "ada",
      limit: 20,
    });
  });

  test("loads product PBV2 options for inbound review", async () => {
    service.getProductOptionsForReview.mockResolvedValue({
      productId: "product_pvc",
      productName: "PVC Signs",
      activeTreeVersionId: "tree_pvc",
      treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {} },
      requiredOptions: [{ nodeId: "thickness", selectionKey: "thickness", label: "Thickness", inputType: "select" }],
      suggestedSelections: { schemaVersion: 2, selected: { thickness: { value: "3mm_white" } } },
      suggestions: [{
        selectionKey: "thickness",
        nodeId: "thickness",
        label: "Thickness",
        value: "3mm_white",
        choiceLabel: "3mm White PVC",
        confidence: 80,
        reason: "Matched source evidence.",
      }],
    });

    const lineItem = {
      sourceText: "3 PVC Signs",
      productName: "PVC Signs",
      selectedProductId: "product_pvc",
      productUnresolved: false,
      quantity: 3,
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      materialText: "3mm White PVC",
      printSpecs: [],
      optionTexts: [],
      finishingTexts: [],
      optionSelectionsJson: null,
      pbv2TreeVersionId: null,
      pbv2OptionSuggestions: [],
      notes: null,
    };

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/product-options/product_pvc")
      .send({ lineItem });

    expect(response.status).toBe(200);
    expect(response.body.data.activeTreeVersionId).toBe("tree_pvc");
    expect(response.body.data.suggestions[0].choiceLabel).toBe("3mm White PVC");
    expect(service.getProductOptionsForReview).toHaveBeenCalledWith({
      organizationId: "org_1",
      productId: "product_pvc",
      lineItem,
    });
  });

  test("blocks draft conversion during phase 1", async () => {
    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/create-quote-draft")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("Phase 1 is review-only");
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("parses an inbound record through the review-only parse route", async () => {
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft });
    parsingService.parseInboundOrderRecord.mockResolvedValue({
      draft,
      latestAttempt: attempt,
      record: inboundRecord({ parsedAt: new Date("2026-06-09T12:01:00.000Z") }),
    });

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/inbound_1/parse")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.draft.customer.customerCandidates[0].label).toBe("Ada Signs");
    expect(response.body.data.latestAttempt.status).toBe("success");
    expect(parsingService.parseInboundOrderRecord).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("returns safe JSON when parse target is not found", async () => {
    parsingService.parseInboundOrderRecord.mockRejectedValue(new InboundOrderTransitionError("Inbound order record not found", 404));

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/missing/parse")
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Inbound order record not found");
  });

  test("blocks parsing converted records", async () => {
    parsingService.parseInboundOrderRecord.mockRejectedValue(new InboundOrderTransitionError("Converted inbound records cannot be parsed in Phase 2.", 409));

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/inbound_1/parse")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("Converted inbound records cannot be parsed");
  });

  test("returns latest parsed draft preview", async () => {
    const draft = parsedDraft({
      order: {
        ...parsedDraft().order,
        requestedDueDate: "2026-06-11",
      },
      evidence: {
        items: [{
          type: "PDF_ATTACHMENT",
          label: "Brainstorm Print PO.pdf",
          sourceId: "file_1",
          fileName: "Brainstorm Print PO.pdf",
          mimeType: "application/pdf",
          rawText: "Purchase Order 151661\nArrival Due Date; MUST EOD 6/11\n3 PVC Signs\n24x36\n3mm White PVC",
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
            dateCandidates: [{
              parsedDate: "2026-06-11",
              sourceText: "Arrival Due Date; MUST EOD 6/11",
              classification: "DUE_DATE",
              confidence: 98,
            }],
            fieldSources: {
              dueDate: {
                value: "2026-06-11",
                sourceType: "PDF_ATTACHMENT",
                sourceDocument: "Purchase Order 151661",
                sourceText: "Arrival Due Date; MUST EOD 6/11",
                confidence: 98,
              },
            },
          },
          warnings: [],
        }],
        conflicts: [],
      },
    });
    const attempt = parseAttempt({ parsedDraft: draft });
    parsingService.getDraftPreview.mockResolvedValue({ draft, latestAttempt: attempt });

    const response = await request(buildApp(service, { parsingService }))
      .get("/api/inbound-orders/inbound_1/draft-preview");

    expect(response.status).toBe(200);
    expect(response.body.data.draft.lineItems[0].productName).toBe("Banner");
    expect(response.body.data.draft.order.requestedDueDate).toBe("2026-06-11");
    expect(response.body.data.draft.evidence.items[0].poSummary.dateCandidates[0].classification).toBe("DUE_DATE");
    expect(response.body.data.draft.evidence.items[0].poSummary.fieldSources.dueDate).toMatchObject({
      value: "2026-06-11",
      sourceDocument: "Purchase Order 151661",
      sourceText: "Arrival Due Date; MUST EOD 6/11",
      confidence: 98,
    });
    expect(response.body.data.latestAttempt.confidence).toBe(88);
    expect(parsingService.getDraftPreview).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
    });
  });

  test("loads an editable review draft", async () => {
    service.getReviewDraft.mockResolvedValue(reviewDraft());

    const response = await request(buildApp(service))
      .get("/api/inbound-orders/inbound_1/review-draft");

    expect(response.status).toBe(200);
    expect(response.body.data.reviewedOrderJson.dueDate).toBe("2026-06-11");
    expect(service.getReviewDraft).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
  });

  test("saves an editable review draft", async () => {
    const saved = reviewDraft({
      reviewedLineItemsJson: [{ ...reviewDraft().reviewedLineItemsJson[0], quantity: 4 }],
      validationErrors: [],
    });
    service.saveReviewDraft.mockResolvedValue(saved);

    const response = await request(buildApp(service))
      .put("/api/inbound-orders/inbound_1/review-draft")
      .send({
        reviewedCustomerJson: saved.reviewedCustomerJson,
        reviewedOrderJson: saved.reviewedOrderJson,
        reviewedLineItemsJson: saved.reviewedLineItemsJson,
        reviewedArtworkJson: saved.reviewedArtworkJson,
        missingDecisionsJson: saved.missingDecisionsJson,
        warningsJson: saved.warningsJson,
        reviewNotes: "Saved edits",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.reviewedLineItemsJson[0].quantity).toBe(4);
    expect(service.saveReviewDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    }));
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("returns review draft validation errors when mark ready fails", async () => {
    service.markReviewDraftReady.mockRejectedValue(new InboundOrderReviewDraftValidationError(
      "Review draft is not ready to convert.",
      ["Select a customer candidate or mark the customer unresolved."],
    ));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/review-draft/mark-ready")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(["Select a customer candidate or mark the customer unresolved."]);
  });

  test("reopens a ready review draft", async () => {
    service.reopenReviewDraft.mockResolvedValue(reviewDraft({ status: "draft", validationErrors: [] }));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/review-draft/reopen")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("draft");
    expect(service.reopenReviewDraft).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
  });

  test("refreshes an editable review draft from the latest parse by explicit staff action", async () => {
    service.refreshReviewDraftFromLatestParse.mockResolvedValue(reviewDraft({
      snapshotId: "snapshot_2",
      id: "snapshot_2",
      initializedFromParse: true,
      hasNewerParse: false,
      validationErrors: [],
    }));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/review-draft/refresh-from-latest-parse")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.snapshotId).toBe("snapshot_2");
    expect(response.body.data.initializedFromParse).toBe(true);
    expect(service.refreshReviewDraftFromLatestParse).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
  });

  test("converts a ready inbound review draft to a real draft order", async () => {
    const convertedAt = "2026-06-09T12:30:00.000Z";
    service.convertInboundReviewDraftToOrder.mockResolvedValue({
      orderId: "order_1",
      inboundOrderId: "inbound_1",
      convertedAt,
      order: {
        id: "order_1",
        orderNumber: "1001",
        status: "new",
        state: "open",
        fulfillmentStatus: "pending",
        paymentStatus: "unpaid",
        lineItems: [{
          id: "order_line_1",
          status: "new",
          workflowState: "new",
          requiresProofApproval: false,
          requiresPrepress: false,
          approvedProofVersionId: null,
        }],
      },
      inbound: inboundDetail(inboundRecord({ status: "submitted", createdOrderId: "order_1" })),
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/convert-to-order")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      orderId: "order_1",
      inboundOrderId: "inbound_1",
      convertedAt,
      alreadyConverted: false,
    });
    expect(response.body.data.order).toMatchObject({
      status: "new",
      state: "open",
      fulfillmentStatus: "pending",
      paymentStatus: "unpaid",
    });
    expect(service.convertInboundReviewDraftToOrder).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("returns safe validation JSON when inbound conversion is blocked", async () => {
    service.convertInboundReviewDraftToOrder.mockRejectedValue(new InboundOrderConversionValidationError(
      "Inbound review draft is not ready for order conversion.",
      ["Select an existing customer before creating a draft order."],
    ));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/convert-to-order")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(["Select an existing customer before creating a draft order."]);
  });

  test("returns failed parse attempts without exposing internals", async () => {
    const failedAttempt = parseAttempt({
      status: "failed",
      provider: null,
      model: null,
      parsedDraft: null,
      confidence: 0,
      warnings: [],
      errors: [{ code: "provider_unavailable", message: "AI provider is not configured." }],
    });
    parsingService.parseInboundOrderRecord.mockResolvedValue({
      draft: null,
      latestAttempt: failedAttempt,
      record: inboundRecord(),
    });

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/inbound_1/parse")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.draft).toBeNull();
    expect(response.body.data.latestAttempt.status).toBe("failed");
    expect(response.body.data.latestAttempt.errors[0].message).toBe("AI provider is not configured.");
  });

  test("fails softly when inbound tables are not migrated", async () => {
    service.listInboundOrders.mockRejectedValue(new Error('relation "inbound_order_records" does not exist'));

    const response = await request(buildApp(service)).get("/api/inbound-orders");

    expect(response.status).toBe(503);
    expect(response.body.message).toContain("Inbound order tables are not available");
  });
});
