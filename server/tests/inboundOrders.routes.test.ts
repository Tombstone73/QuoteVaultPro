import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

jest.mock("../services/pricing/PricingService", () => ({
  priceLineItem: jest.fn(),
}));

import { registerInboundOrderRoutes } from "../routes/inboundOrders.routes";
import {
  InboundEmailIngestionError,
} from "../services/inboundEmailIngestionService";
import {
  InboundOrderConversionValidationError,
  InboundOrderReviewDraftValidationError,
  InboundOrderTransitionError,
} from "../services/inboundOrders/InboundOrderService";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { storageProviderConfigRepository } from "../storage/storageProviderConfig.repo";
import { storageRegistry } from "../services/storage/StorageRegistry";

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

function inboundEmailIgnoreRule(overrides: Record<string, any> = {}) {
  const now = new Date("2026-06-17T12:00:00.000Z");
  return {
    id: "rule_1",
    organizationId: "org_1",
    enabled: true,
    ruleType: "sender_email_exact",
    ruleValue: "notifications@example.com",
    notes: "Processor notice",
    matchCount: 0,
    lastMatchedAt: null,
    createdByUserId: "user_1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function inboundEmailTrustRule(overrides: Record<string, any> = {}) {
  const now = new Date("2026-06-17T12:00:00.000Z");
  return {
    id: "trust_1",
    organizationId: "org_1",
    enabled: true,
    ruleType: "sender_domain",
    ruleValue: "example.com",
    notes: "Known customer domain",
    matchCount: 0,
    lastMatchedAt: null,
    createdByUserId: "user_1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function emailPullDiagnostics(overrides: Record<string, any> = {}) {
  return {
    organizationId: "org_1",
    generatedAt: "2026-06-18T15:00:00.000Z",
    subject: null,
    enabledMailboxCount: 1,
    mailboxes: [{
      id: "mailbox_1",
      provider: "gmail",
      name: "Orders Inbox",
      emailAddress: "orders@example.com",
      enabled: true,
      isDefault: true,
      lastPulledAt: "2026-06-18T14:55:00.000Z",
      lastPullStatus: "success",
      lastPullError: null,
      latestPullSummary: null,
    }],
    latestPullSummary: null,
    recentPullMessageDiagnostics: [],
    recentFailedMessageDiagnostics: [],
    recentIgnoredMessageDiagnostics: [],
    recentCreatedInboundRecords: [{
      id: "inbound_email_1",
      status: "needs_review",
      reviewOutcome: null,
      subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
      sourceMessageId: "gmail_msg_1",
      createdAt: "2026-06-18T14:55:01.000Z",
    }],
    recentInboundFiles: [{
      id: "file_1",
      inboundRecordId: "inbound_email_1",
      sourceFilename: "po-151753.pdf",
      role: "po",
      status: "available",
      metadataJson: { provider: "gmail" },
    }],
    recentGmailListedMessages: [],
    ignoreRuleCount: 1,
    activeIgnoreRules: [{
      id: "rule_1",
      ruleType: "subject_contains",
      ruleValuePreview: "Payment Received",
      enabled: true,
      matchCount: 2,
      lastMatchedAt: "2026-06-17T12:00:00.000Z",
      notes: "Processor notices",
    }],
    subjectSearch: {
      provided: false,
      found: false,
      matchingRecords: [],
      matchingFiles: [],
      matchingIgnoreRules: [],
      matchingGmailListedMessages: [],
      notReturnedByGmailListQuery: false,
      gmailListMessage: null,
      duplicateDetection: {
        durableSkippedMessageLogsStored: false,
        possibleDuplicateRecords: [],
      },
    },
    storageNotes: {
      latestPullSummaryStored: false,
      perMessageFailureDiagnosticsStored: false,
      ignoredMessageDiagnosticsStored: false,
      duplicateSkipDiagnosticsStored: false,
    },
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
      intent: "unknown",
      poNumber: "151661",
      dueDate: "2026-06-11",
      priority: "normal",
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
      selectedProductSource: "ai_inferred",
      productUnresolved: false,
      quantity: 3,
      quantitySource: "ai_inferred",
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      dimensionsSource: "ai_inferred",
      materialText: "3mm White PVC",
      materialSource: "ai_inferred",
      printSpecs: [],
      printSpecsSource: null,
      optionTexts: [],
      optionTextsSource: null,
      finishingTexts: [],
      finishingTextsSource: null,
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

const defaultInboundOrdersRepository = {
  createEvent: jest.fn<(...args: any[]) => Promise<any>>(async (values) => ({
    id: "event_1",
    createdAt: new Date("2026-06-09T12:03:00.000Z"),
    ...values,
  })),
};

function buildApp(
  service: Record<string, any>,
  options: {
    orgId?: string;
    internal?: boolean;
    parsingService?: Record<string, any>;
    inboundEmailIntakeSettingsService?: Record<string, any>;
    inboundEmailIngestionService?: Record<string, any>;
    inboundEmailMailboxSettingsService?: Record<string, any>;
    inboundOrdersRepository?: Record<string, any>;
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
    inboundOrdersRepository: (options.inboundOrdersRepository ?? defaultInboundOrdersRepository) as any,
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
    searchProducts: jest.fn<(...args: any[]) => Promise<any>>(),
    getProductOptionsForReview: jest.fn<(...args: any[]) => Promise<any>>(),
    applyReviewAction: jest.fn(),
    saveReviewSnapshot: jest.fn(),
    getQuoteDraftPreview: jest.fn(),
    matchCustomer: jest.fn(),
    createCustomerForInbound: jest.fn(),
    matchLineItemProduct: jest.fn(),
    resolveWarning: jest.fn(),
    resolveDecisionFlag: jest.fn(),
    createOrderFromReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    convertInboundReviewDraftToOrder: jest.fn<(...args: any[]) => Promise<any>>(),
    applyBulkQueueAction: jest.fn<(...args: any[]) => Promise<any>>(),
    combineInboundRecords: jest.fn<(...args: any[]) => Promise<any>>(),
    attachInboundRecordToOrder: jest.fn<(...args: any[]) => Promise<any>>(),
    createQuoteDraftFromInbound: jest.fn(),
    getReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    saveReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    markReviewDraftReady: jest.fn<(...args: any[]) => Promise<any>>(),
    reopenReviewDraft: jest.fn<(...args: any[]) => Promise<any>>(),
    refreshReviewDraftFromLatestParse: jest.fn<(...args: any[]) => Promise<any>>(),
    listEmailIgnoreRules: jest.fn<(...args: any[]) => Promise<any>>(),
    getEmailPullDiagnostics: jest.fn<(...args: any[]) => Promise<any>>(),
    createEmailIgnoreRule: jest.fn<(...args: any[]) => Promise<any>>(),
    updateEmailIgnoreRule: jest.fn<(...args: any[]) => Promise<any>>(),
    deleteEmailIgnoreRule: jest.fn<(...args: any[]) => Promise<any>>(),
    listEmailTrustRules: jest.fn<(...args: any[]) => Promise<any>>(),
    createEmailTrustRule: jest.fn<(...args: any[]) => Promise<any>>(),
    updateEmailTrustRule: jest.fn<(...args: any[]) => Promise<any>>(),
    deleteEmailTrustRule: jest.fn<(...args: any[]) => Promise<any>>(),
    updateAttachmentClassification: jest.fn<(...args: any[]) => Promise<any>>(),
    bulkUpdateAttachmentClassification: jest.fn<(...args: any[]) => Promise<any>>(),
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
    getGmailPayloadDiagnosticsForSubject: jest.fn<(...args: any[]) => Promise<any>>(),
    approveAttachmentTrustAction: jest.fn<(...args: any[]) => Promise<any>>(),
    approveRecordTrustAction: jest.fn<(...args: any[]) => Promise<any>>(),
    manuallyReprocessInboundEmailRecord: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const inboundEmailMailboxSettingsService = {
    listMailboxes: jest.fn<(...args: any[]) => Promise<any>>(),
    updateMailboxEnabled: jest.fn<(...args: any[]) => Promise<any>>(),
    updateMailboxSettings: jest.fn<(...args: any[]) => Promise<any>>(),
    setDefaultMailbox: jest.fn<(...args: any[]) => Promise<any>>(),
    deleteMailbox: jest.fn<(...args: any[]) => Promise<any>>(),
    connectGmailMailbox: jest.fn<(...args: any[]) => Promise<any>>(),
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

  test("manual email pull runs after an enabled inbound mailbox is connected", async () => {
    inboundEmailIntakeSettingsService.getPullGuard.mockResolvedValue({
      allowed: true,
      settings: {
        inboundEmailIntakeEnabled: true,
        inboundEmailPullPaused: false,
      },
    });
    inboundEmailMailboxSettingsService.listMailboxes.mockResolvedValue([{
      id: "mailbox_connected",
      provider: "gmail",
      name: "Orders Inbox",
      emailAddress: "orders@example.com",
      enabled: true,
      isDefault: true,
      lastPulledAt: null,
      lastPullStatus: null,
      lastPullError: null,
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z",
    }]);
    inboundEmailIngestionService.pullLatestEmails.mockResolvedValue({
      summary: { created: 1, skippedDuplicates: 0, ignored: 0, failed: 0 },
      createdRecordIds: ["inbound_email_1"],
      mailboxResults: [{
        mailboxId: "mailbox_connected",
        mailboxName: "Orders Inbox",
        provider: "gmail",
        created: 1,
        skippedDuplicates: 0,
        ignored: 0,
        failed: 0,
        error: null,
      }],
    });

    const response = await request(buildApp(service, {
      inboundEmailIntakeSettingsService,
      inboundEmailIngestionService,
      inboundEmailMailboxSettingsService,
    }))
      .post("/api/inbound-orders/email/pull-latest")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.summary.created).toBe(1);
    expect(inboundEmailIngestionService.pullLatestEmails).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      limit: undefined,
    });
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
  });

  test("email pull diagnostics are owner/admin only and do not pull new emails", async () => {
    service.getEmailPullDiagnostics.mockResolvedValue(emailPullDiagnostics());

    const denied = await request(buildApp(service, { userRole: "member" }))
      .get("/api/inbound-orders/email/pull-diagnostics");

    expect(denied.status).toBe(403);
    expect(service.getEmailPullDiagnostics).not.toHaveBeenCalled();
    expect(inboundEmailIngestionService.pullLatestEmails).not.toHaveBeenCalled();

    const allowed = await request(buildApp(service))
      .get("/api/inbound-orders/email/pull-diagnostics");

    expect(allowed.status).toBe(200);
    expect(allowed.body.data.enabledMailboxCount).toBe(1);
    expect(service.getEmailPullDiagnostics).toHaveBeenCalledWith({
      organizationId: "org_1",
      subject: null,
    });
    expect(inboundEmailIngestionService.pullLatestEmails).not.toHaveBeenCalled();
  });

  test("email pull diagnostics redacts secrets and reports last pull errors", async () => {
    service.getEmailPullDiagnostics.mockResolvedValue(emailPullDiagnostics({
      mailboxes: [{
        id: "mailbox_failed",
        provider: "gmail",
        name: "Orders Inbox",
        emailAddress: "orders@example.com",
        enabled: true,
        isDefault: true,
        lastPulledAt: "2026-06-18T14:55:00.000Z",
        lastPullStatus: "failed",
        lastPullError: "invalid_grant",
        latestPullSummary: { failed: 1 },
        authJson: { refreshToken: "secret_refresh_token" },
      }],
      latestPullSummary: { failed: 1 },
      recentFailedMessageDiagnostics: [{
        message: "Attachment download failed",
        metadataJson: {
          filename: "po.pdf",
          refreshToken: "secret_refresh_token",
        },
      }],
    }));

    const response = await request(buildApp(service))
      .get("/api/inbound-orders/email/pull-diagnostics");

    expect(response.status).toBe(200);
    expect(response.body.data.mailboxes[0]).toMatchObject({
      lastPullStatus: "failed",
      lastPullError: "invalid_grant",
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("authJson");
    expect(serialized).not.toContain("refreshToken");
    expect(serialized).not.toContain("secret_refresh_token");
  });

  test("email pull diagnostics subject search includes active and inactive records", async () => {
    service.getEmailPullDiagnostics.mockResolvedValue(emailPullDiagnostics({
      subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
      subjectSearch: {
        provided: true,
        found: true,
        matchingRecords: [
          { id: "active_1", status: "needs_review", reviewOutcome: null, subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26" },
          { id: "ignored_1", status: "ignored", reviewOutcome: "ignored", subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26" },
          { id: "rejected_1", status: "terminal", reviewOutcome: "rejected", subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26" },
          { id: "archived_1", status: "needs_review", reviewOutcome: null, archivedAt: "2026-06-18T15:00:00.000Z", subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26" },
        ],
        matchingFiles: [{ id: "file_1", sourceFilename: "Titan Compass ACM Sign.pdf" }],
        matchingIgnoreRules: [],
        duplicateDetection: {
          durableSkippedMessageLogsStored: false,
          possibleDuplicateRecords: [{ id: "active_1", idempotencyKey: "gmail:gmail_msg_1" }],
        },
      },
    }));
    inboundEmailIngestionService.getGmailPayloadDiagnosticsForSubject.mockResolvedValue([{
      inboundRecordId: "active_1",
      sourceMessageId: "gmail_msg_1",
      extractedAttachmentCount: 1,
      payloadTree: {
        partId: null,
        mimeType: "multipart/mixed",
        filenamePresent: false,
        filename: null,
        attachmentIdPresent: false,
        bodySize: null,
        headers: { contentType: null, contentDisposition: null, contentId: null },
        childParts: [],
      },
    }]);

    const response = await request(buildApp(service, { inboundEmailIngestionService }))
      .get("/api/inbound-orders/email/pull-diagnostics?subject=Purchase%20Order%20No%20151753%20Titan%20Compass%20ACM%20Sign%206_18_26");

    expect(response.status).toBe(200);
    expect(response.body.data.subjectSearch.found).toBe(true);
    expect(response.body.data.subjectSearch.matchingRecords.map((record: any) => record.id)).toEqual([
      "active_1",
      "ignored_1",
      "rejected_1",
      "archived_1",
    ]);
    expect(response.body.data.subjectSearch.matchingFiles[0].sourceFilename).toContain("Titan Compass");
    expect(response.body.data.subjectSearch.gmailPayloadDiagnostics[0]).toMatchObject({
      inboundRecordId: "active_1",
      sourceMessageId: "gmail_msg_1",
      extractedAttachmentCount: 1,
    });
    expect(service.getEmailPullDiagnostics).toHaveBeenCalledWith({
      organizationId: "org_1",
      subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
    });
    expect(inboundEmailIngestionService.getGmailPayloadDiagnosticsForSubject).toHaveBeenCalledWith({
      organizationId: "org_1",
      subject: "Purchase Order No 151753 Titan Compass ACM Sign 6_18_26",
      limit: 3,
    });
    expect(inboundEmailIngestionService.pullLatestEmails).not.toHaveBeenCalled();
  });

  test("email pull diagnostics handles no mailbox configured", async () => {
    service.getEmailPullDiagnostics.mockResolvedValue(emailPullDiagnostics({
      enabledMailboxCount: 0,
      mailboxes: [],
      latestPullSummary: null,
    }));

    const response = await request(buildApp(service))
      .get("/api/inbound-orders/email/pull-diagnostics");

    expect(response.status).toBe(200);
    expect(response.body.data.enabledMailboxCount).toBe(0);
    expect(response.body.data.mailboxes).toEqual([]);
  });

  test("starts inbound Gmail OAuth without using the outbound Gmail connection", async () => {
    const restoreEnv = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    const originalSessionSecret = process.env.SESSION_SECRET;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalAppUrl = process.env.APP_URL;
    const originalInboundRedirect = process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI;
    process.env.SESSION_SECRET = "test_session_secret";
    process.env.GOOGLE_CLIENT_ID = "client_123";
    process.env.GOOGLE_CLIENT_SECRET = "client_secret";
    process.env.APP_URL = "https://dev.printershero.com";
    delete process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI;

    try {
      const response = await request(buildApp(service))
        .get("/api/inbound-orders/email/mailboxes/gmail/start?reconnectMailboxId=mailbox_1");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const url = String(response.body.data.url);
      expect(url).toContain("accounts.google.com");
      expect(decodeURIComponent(url)).toContain("https://www.googleapis.com/auth/gmail.readonly");
      expect(decodeURIComponent(url)).toContain("/api/inbound-orders/email/mailboxes/gmail/callback");
      expect(decodeURIComponent(url)).toContain("inbound_gmail");
      expect(url).not.toContain("/api/email/google/callback");
    } finally {
      restoreEnv("SESSION_SECRET", originalSessionSecret);
      restoreEnv("GOOGLE_CLIENT_ID", originalClientId);
      restoreEnv("GOOGLE_CLIENT_SECRET", originalClientSecret);
      restoreEnv("APP_URL", originalAppUrl);
      restoreEnv("GOOGLE_INBOUND_OAUTH_REDIRECT_URI", originalInboundRedirect);
    }
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

  test("creates a manual inbound email ignore rule with editable fields", async () => {
    service.createEmailIgnoreRule.mockResolvedValue(inboundEmailIgnoreRule({
      ruleType: "sender_domain",
      ruleValue: "payments.example.com",
      enabled: false,
      notes: "Processor notices",
    }));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/email/ignore-rules")
      .send({
        ruleType: "sender_domain",
        ruleValue: "Payments.Example.COM",
        enabled: false,
        notes: "Processor notices",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      ruleType: "sender_domain",
      ruleValue: "payments.example.com",
      enabled: false,
      notes: "Processor notices",
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z",
    });
    expect(service.createEmailIgnoreRule).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_domain",
      ruleValue: "Payments.Example.COM",
      enabled: false,
      notes: "Processor notices",
    });
  });

  test("updates manual inbound email ignore rule type, value, notes, and enabled state", async () => {
    service.updateEmailIgnoreRule.mockResolvedValue(inboundEmailIgnoreRule({
      id: "rule_1",
      ruleType: "subject_contains",
      ruleValue: "New submission from",
      enabled: true,
      notes: "Website forms",
    }));

    const response = await request(buildApp(service))
      .patch("/api/inbound-orders/email/ignore-rules/rule_1")
      .send({
        ruleType: "subject_contains",
        ruleValue: "New submission from",
        enabled: true,
        notes: "Website forms",
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: "rule_1",
      ruleType: "subject_contains",
      ruleValue: "New submission from",
      enabled: true,
      notes: "Website forms",
    });
    expect(service.updateEmailIgnoreRule).toHaveBeenCalledWith({
      organizationId: "org_1",
      id: "rule_1",
      ruleType: "subject_contains",
      ruleValue: "New submission from",
      enabled: true,
      notes: "Website forms",
    });
  });

  test("returns safe conflict JSON for duplicate inbound email ignore rules", async () => {
    service.createEmailIgnoreRule.mockRejectedValue(new InboundOrderTransitionError(
      "An enabled inbound email ignore rule already exists for this type and value.",
      409,
    ));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/email/ignore-rules")
      .send({
        ruleType: "sender_email_exact",
        ruleValue: "notifications@example.com",
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      message: "An enabled inbound email ignore rule already exists for this type and value.",
    });
  });

  test("manages inbound email trust rules", async () => {
    service.listEmailTrustRules.mockResolvedValue([inboundEmailTrustRule()]);
    service.createEmailTrustRule.mockResolvedValue(inboundEmailTrustRule({
      id: "trust_2",
      ruleType: "sender_email_exact",
      ruleValue: "orders@example.com",
      notes: "Approved sender",
    }));

    const listResponse = await request(buildApp(service))
      .get("/api/inbound-orders/email/trust-rules");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.rules[0]).toMatchObject({
      id: "trust_1",
      ruleType: "sender_domain",
      ruleValue: "example.com",
    });

    const createResponse = await request(buildApp(service))
      .post("/api/inbound-orders/email/trust-rules")
      .send({
        ruleType: "sender_email_exact",
        ruleValue: "orders@example.com",
        notes: "Approved sender",
      });

    expect(createResponse.status).toBe(201);
    expect(service.createEmailTrustRule).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      actorUserId: "user_1",
      ruleType: "sender_email_exact",
      ruleValue: "orders@example.com",
      notes: "Approved sender",
    }));
  });

  test("applies inbound attachment trust action without creating downstream records", async () => {
    inboundEmailIngestionService.approveAttachmentTrustAction.mockResolvedValue({
      id: "file_1",
      inboundRecordId: "inbound_1",
      sourceFilename: "po.pdf",
      fileRecordId: "file_record_1",
      status: "available",
      metadataJson: { attachmentState: "downloaded" },
    });

    const response = await request(buildApp(service, { inboundEmailIngestionService }))
      .post("/api/inbound-orders/inbound_1/files/file_1/trust-action")
      .send({ action: "download_once" });

    expect(response.status).toBe(200);
    expect(inboundEmailIngestionService.approveAttachmentTrustAction).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      fileId: "file_1",
      action: "download_once",
      note: null,
    });
  });

  test("updates inbound attachment classification and can remember it for a customer", async () => {
    service.updateAttachmentClassification.mockResolvedValue({
      file: {
        id: "file_1",
        inboundRecordId: "inbound_1",
        sourceFilename: "Purchase Order No 151866 Titan Merchants Sign 7_6_26.pdf",
        role: "po",
        metadataJson: {
          attachmentClassification: { classification: "PO", source: "manual_override", confidence: 100 },
        },
      },
      rule: {
        id: "rule_1",
        customerId: "customer_1",
        matchType: "filename_contains",
        matchValue: "Purchase Order",
        classification: "purchase_order",
      },
      warning: null,
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/files/file_1/classification")
      .send({
        classification: "PO",
        rememberForCustomer: true,
        rule: {
          customerId: "customer_1",
          senderDomain: "brainstormprint.com",
          matchType: "filename_contains",
          matchValue: "Purchase Order",
        },
      });

    expect(response.status).toBe(200);
    expect(service.updateAttachmentClassification).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      fileId: "file_1",
      classification: "PO",
      rememberForCustomer: true,
      rule: {
        customerId: "customer_1",
        senderDomain: "brainstormprint.com",
        matchType: "filename_contains",
        matchValue: "Purchase Order",
      },
    });
    expect(response.body.data.file.role).toBe("po");
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
  });

  test("bulk updates inbound attachment classifications through the shared service path", async () => {
    service.bulkUpdateAttachmentClassification.mockResolvedValue({
      files: [
        { id: "file_1", inboundRecordId: "inbound_1", sourceFilename: "art-1.pdf", role: "artwork", metadataJson: {} },
        { id: "file_2", inboundRecordId: "inbound_1", sourceFilename: "art-2.pdf", role: "artwork", metadataJson: {} },
      ],
      errors: [{ fileId: "file_unsafe", message: "Unsafe or quarantined attachments cannot be classified as usable artwork. Resolve the attachment safety state first." }],
      warnings: [],
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/files/classification/bulk")
      .send({ fileIds: ["file_1", "file_2", "file_unsafe"], classification: "ARTWORK" });

    expect(response.status).toBe(200);
    expect(service.bulkUpdateAttachmentClassification).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      fileIds: ["file_1", "file_2", "file_unsafe"],
      classification: "ARTWORK",
    });
    expect(response.body.data.files).toHaveLength(2);
    expect(response.body.data.errors[0].fileId).toBe("file_unsafe");
  });

  test.each(["PO", "REFERENCE", "IGNORE_INLINE", "reset_to_ai"])("accepts bulk attachment classification action %s", async (classification) => {
    service.bulkUpdateAttachmentClassification.mockResolvedValue({ files: [], errors: [], warnings: [] });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/files/classification/bulk")
      .send({ fileIds: ["file_1"], classification });

    expect(response.status).toBe(200);
    expect(service.bulkUpdateAttachmentClassification).toHaveBeenCalledWith(expect.objectContaining({
      inboundRecordId: "inbound_1",
      fileIds: ["file_1"],
      classification,
    }));
  });

  test("allows authorized staff to download stored quarantined ZIP attachments without exposing storage paths", async () => {
    const zipFile = {
      id: "zip_file_1",
      inboundRecordId: "inbound_1",
      sourceFilename: "Glass Barn Tractor Signs - 2026[1].zip",
      role: "artwork",
      mimeType: "application/zip",
      sizeBytes: 2,
      fileRecordId: "file_record_zip",
      status: "quarantined",
      metadataJson: { attachmentState: "scan_pending", attachmentExtension: "zip" },
    };
    service.getInboundOrder.mockResolvedValue({
      ...inboundDetail(inboundRecord()),
      files: [zipFile],
    });
    const resolveSpy = jest.spyOn(canonicalFileReadResolver, "resolveOriginal").mockResolvedValue({
      fileRecordId: "file_record_zip",
      status: "available",
      placementState: "active",
      providerConfigId: "provider_1",
      providerType: "titan_managed",
      bucket: "private",
      objectKey: "org_1/inbound/zip_file_1.zip",
      localPathRef: null,
      displayFilename: "Glass Barn Tractor Signs - 2026[1].zip",
      mimeType: "application/zip",
    });
    const providerSpy = jest.spyOn(storageProviderConfigRepository, "getByIdForOrganization").mockResolvedValue({
      id: "provider_1",
      organizationId: "org_1",
      providerType: "titan_managed",
      role: "primary",
      name: "Private storage",
      configJson: {},
      enabled: true,
      createdAt: new Date("2026-06-09T12:00:00.000Z"),
      updatedAt: new Date("2026-06-09T12:00:00.000Z"),
    } as any);
    const storageSpy = jest.spyOn(storageRegistry, "getAdapter").mockReturnValue({
      getDownloadHandle: jest.fn(async () => ({ kind: "signed_url", value: "https://storage.example/private/zip_file_1.zip" })),
    } as any);
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/zip" }),
      arrayBuffer: async () => Buffer.from("PK").buffer,
    } as any);

    try {
      const response = await request(buildApp(service))
        .get("/api/inbound-orders/inbound_1/files/zip_file_1/download");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/zip");
      expect(response.headers["content-disposition"]).toContain("attachment;");
      expect(response.headers["content-disposition"]).toContain("Glass Barn Tractor Signs - 2026[1].zip");
      expect(response.text).not.toContain("storage.example");
      expect(fetchSpy).toHaveBeenCalledWith("https://storage.example/private/zip_file_1.zip");
    } finally {
      resolveSpy.mockRestore();
      providerSpy.mockRestore();
      storageSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  test("applies inbound record trust action and returns refreshed inbound detail", async () => {
    inboundEmailIngestionService.approveRecordTrustAction.mockResolvedValue({
      trustRuleType: "sender_email_exact",
      trustRuleValue: "buyer@example.com",
      attempted: 1,
      downloaded: 1,
      metadataOnly: 0,
      blocked: 0,
      failed: [],
    });
    service.getInboundOrder.mockResolvedValue(inboundDetail(inboundRecord({
      sourceType: "email",
      senderTrustStatus: "trusted_sender",
      attachmentDownloadPolicy: "auto_download_allowed",
    })));

    const response = await request(buildApp(service, { inboundEmailIngestionService }))
      .post("/api/inbound-orders/inbound_1/trust-action")
      .send({ action: "trust_sender_and_download" });

    expect(response.status).toBe(200);
    expect(inboundEmailIngestionService.approveRecordTrustAction).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "trust_sender_and_download",
      note: null,
    });
    expect(response.body.data.result.downloaded).toBe(1);
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
  });

  test("manually backfills inbound email attachments without creating downstream records", async () => {
    inboundEmailIngestionService.manuallyReprocessInboundEmailRecord.mockResolvedValue({
      action: "backfill_attachments",
      inboundRecordId: "inbound_1",
      providerMessageId: "gmail_msg_1",
      providerThreadId: "thread_1",
      threadMessagesInspected: 2,
      latestThreadActivity: "2026-06-19T14:00:00.000Z",
      candidatesFound: 2,
      attempted: 2,
      stored: 1,
      metadataOnly: 1,
      failed: 0,
      skipped: 0,
      diagnosticsByMessage: [],
    });
    service.getInboundOrder.mockResolvedValue(inboundDetail(inboundRecord({ sourceType: "email" })));

    const response = await request(buildApp(service, { inboundEmailIngestionService }))
      .post("/api/inbound-orders/inbound_1/email-reprocess")
      .send({ action: "backfill_attachments" });

    expect(response.status).toBe(200);
    expect(inboundEmailIngestionService.manuallyReprocessInboundEmailRecord).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      inboundRecordId: "inbound_1",
      action: "backfill_attachments",
    });
    expect(response.body.data.result).toMatchObject({ attempted: 2, stored: 1, metadataOnly: 1 });
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
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
      .get("/api/inbound-orders?statusGroup=needs_review&sourceType=manual&trustFilter=pending_attachment_trust&search=banners");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.summary.needsReview).toBe(1);
    expect(service.listInboundOrders).toHaveBeenCalledWith({
      organizationId: "org_2",
      filters: expect.objectContaining({
        statusGroup: "needs_review",
        sourceType: "manual",
        trustFilter: "pending_attachment_trust",
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

  test("bulk trusts selected sender emails without creating downstream records", async () => {
    service.applyBulkQueueAction.mockResolvedValue({
      updatedIds: ["inbound_1", "inbound_2"],
      errors: [],
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/bulk-action")
      .send({
        recordIds: ["inbound_1", "inbound_2"],
        action: "trust_sender",
        note: "Known senders",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.updatedIds).toEqual(["inbound_1", "inbound_2"]);
    expect(service.applyBulkQueueAction).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      recordIds: ["inbound_1", "inbound_2"],
      action: "trust_sender",
      note: "Known senders",
    });
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
  });

  test("combines selected inbound emails through the staff-controlled route", async () => {
    service.combineInboundRecords.mockResolvedValue({
      detail: inboundDetail(inboundRecord({ id: "inbound_parent" })),
      combinedSourceCount: 2,
      reparseRecommended: true,
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/combine")
      .send({
        recordIds: ["inbound_parent", "inbound_child"],
        primaryRecordId: "inbound_parent",
        confirmCustomerMismatch: false,
        confirmMultipleDrafts: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.combinedSourceCount).toBe(2);
    expect(response.body.data.reparseRecommended).toBe(true);
    expect(service.combineInboundRecords).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      recordIds: ["inbound_parent", "inbound_child"],
      primaryRecordId: "inbound_parent",
      confirmCustomerMismatch: false,
      confirmMultipleDrafts: true,
    });
  });

  test("attaches an inbound record to an existing order without creating a quote or order", async () => {
    service.attachInboundRecordToOrder.mockResolvedValue({
      orderId: "order_1",
      orderNumber: "ORD-1001",
      inboundRecordId: "inbound_1",
      createdAttachmentIds: ["order_attachment_1"],
      skippedAttachments: [],
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/attach-to-order")
      .send({
        orderId: "order_1",
        includeMessageHistory: true,
        includeAttachments: true,
        includeParsedNotes: true,
        includeJunkAttachments: false,
        confirmCustomerMismatch: false,
        artworkAssignments: [{ fileId: "file_art", orderLineItemId: "line_1", side: "front" }],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.orderId).toBe("order_1");
    expect(service.attachInboundRecordToOrder).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      orderId: "order_1",
      artworkAssignments: [{ fileId: "file_art", orderLineItemId: "line_1", side: "front" }],
    }));
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
    expect(service.convertInboundReviewDraftToOrder).not.toHaveBeenCalled();
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

  test("creates and assigns a new inbound customer with reviewed sender contact", async () => {
    (service.createCustomerForInbound as any).mockResolvedValue(inboundDetail(inboundRecord({
      matchedCustomerId: "customer_new",
      matchedContactId: "contact_new",
    })));

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/create-customer")
      .send({
        companyName: "Shook Construction",
        contactFirstName: "Monica",
        contactLastName: "Larsen",
        contactEmail: "monica@shook.example",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.record.matchedCustomerId).toBe("customer_new");
    expect(service.createCustomerForInbound).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      companyName: "Shook Construction",
      contactFirstName: "Monica",
      contactLastName: "Larsen",
      contactEmail: "monica@shook.example",
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
      selectedProductSource: "ai_inferred",
      productUnresolved: false,
      quantity: 3,
      quantitySource: "ai_inferred",
      width: 24,
      height: 36,
      dimensionsUnit: "in",
      dimensionsSource: "ai_inferred",
      materialText: "3mm White PVC",
      materialSource: "ai_inferred",
      printSpecs: [],
      printSpecsSource: null,
      optionTexts: [],
      optionTextsSource: null,
      finishingTexts: [],
      finishingTextsSource: null,
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

  test("searches active products for inbound review", async () => {
    service.searchProducts.mockResolvedValue([{
      id: "product_pvc",
      name: "PVC Signs",
      description: "Rigid PVC signs",
      category: "Signs",
      pricingMode: "area",
      pbv2ActiveTreeVersionId: "tree_pvc",
      isActive: true,
    }]);

    const response = await request(buildApp(service))
      .get("/api/inbound-orders/product-search?search=pvc&limit=10");

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      id: "product_pvc",
      name: "PVC Signs",
    });
    expect(service.searchProducts).toHaveBeenCalledWith({
      organizationId: "org_1",
      search: "pvc",
      limit: 10,
    });
  });

  test("creates a draft quote from an inbound review", async () => {
    (service.createQuoteDraftFromInbound as any).mockResolvedValue({
      quote: {
        id: "quote_1",
        quoteNumber: 101,
        reference: "Quote #101",
        status: "draft",
        customerId: "customer_1",
        contactId: "contact_1",
        customerName: "Ada Signs",
        contactName: "Ada Lovelace",
        totalPrice: "0",
        createdAt: new Date("2026-06-09T12:10:00.000Z"),
        lineItemsCreated: 1,
        convertedLineItemCount: 1,
        skippedLineItemCount: 0,
        skippedLineItems: [],
      },
      inbound: inboundDetail(inboundRecord({ createdQuoteId: "quote_1", status: "submitted" })),
    });

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/create-quote-draft")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.quote.id).toBe("quote_1");
    expect(service.createQuoteDraftFromInbound).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
  });

  test("parses an inbound record through the review-only parse route", async () => {
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft });
    const persistedDraft = reviewDraft({ sourceParseAttemptId: attempt.id });
    parsingService.parseInboundOrderRecord.mockResolvedValueOnce({
      draft,
      latestAttempt: attempt,
      record: inboundRecord({ parsedAt: new Date("2026-06-09T12:01:00.000Z") }),
    });
    service.refreshReviewDraftFromLatestParse.mockResolvedValueOnce(persistedDraft);

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/inbound_1/parse")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.draft.customer.customerCandidates[0].label).toBe("Ada Signs");
    expect(response.body.data.reviewDraft.id).toBe(persistedDraft.id);
    expect(response.body.data.latestAttempt.status).toBe("success");
    expect(parsingService.parseInboundOrderRecord).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(service.refreshReviewDraftFromLatestParse).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
    });
    expect(defaultInboundOrdersRepository.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "parse.review_draft_persisted",
      metadataJson: expect.objectContaining({
        parseAttemptId: attempt.id,
        reviewDraftId: persistedDraft.id,
        reviewDraftPersisted: true,
      }),
    }));
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("returns a safe operator error when parse succeeds but review draft persistence fails", async () => {
    const draft = parsedDraft();
    const attempt = parseAttempt({ parsedDraft: draft });
    parsingService.parseInboundOrderRecord.mockResolvedValueOnce({
      draft,
      latestAttempt: attempt,
      record: inboundRecord({ parsedAt: new Date("2026-06-09T12:01:00.000Z") }),
    });
    service.refreshReviewDraftFromLatestParse.mockRejectedValueOnce(new Error("snapshot insert failed"));

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/inbound_1/parse")
      .send({});

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Parse could not save the review draft. Please retry.");
    expect(response.body.message).not.toContain("snapshot insert failed");
    expect(defaultInboundOrdersRepository.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "parse.review_draft_persistence_failed",
      metadataJson: expect.objectContaining({
        parseAttemptId: attempt.id,
        reviewDraftPersisted: false,
        errorMessage: "snapshot insert failed",
      }),
    }));
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
      orderNumber: "1001",
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
      orderNumber: "1001",
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

  test("creates an order from the current review draft in one command", async () => {
    service.createOrderFromReviewDraft.mockResolvedValue({
      orderId: "order_1",
      orderNumber: "1001",
      inboundOrderId: "inbound_1",
      convertedAt: "2026-06-09T12:30:00.000Z",
      order: { id: "order_1", orderNumber: "1001" },
      inbound: inboundDetail(inboundRecord({ status: "submitted", createdOrderId: "order_1" })),
    });
    const draft = reviewDraft();

    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/create-order")
      .send(draft);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ orderId: "order_1", orderNumber: "1001" });
    expect(service.createOrderFromReviewDraft).toHaveBeenCalledWith({
      organizationId: "org_1",
      inboundRecordId: "inbound_1",
      actorUserId: "user_1",
      draft: expect.objectContaining({ reviewedLineItemsJson: expect.any(Array) }),
    });
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

  test("returns failed parse attempts without claiming a review draft was produced", async () => {
    const failedAttempt = parseAttempt({
      status: "failed",
      provider: null,
      model: null,
      parsedDraft: null,
      confidence: 0,
      warnings: [],
      errors: [{ code: "provider_unavailable", message: "AI provider is not configured." }],
    });
    parsingService.parseInboundOrderRecord.mockResolvedValueOnce({
      draft: null,
      latestAttempt: failedAttempt,
      record: inboundRecord(),
    });

    const response = await request(buildApp(service, { parsingService }))
      .post("/api/inbound-orders/inbound_1/parse")
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.message).toBe("AI provider is not configured.");
    expect(response.body.data.draft).toBeNull();
    expect(response.body.data.latestAttempt.status).toBe("failed");
    expect(response.body.data.latestAttempt.errors[0].message).toBe("AI provider is not configured.");
    expect(service.refreshReviewDraftFromLatestParse).not.toHaveBeenCalled();
  });

  test("fails softly when inbound tables are not migrated", async () => {
    service.listInboundOrders.mockRejectedValue(new Error('relation "inbound_order_records" does not exist'));

    const response = await request(buildApp(service)).get("/api/inbound-orders");

    expect(response.status).toBe(503);
    expect(response.body.message).toContain("Inbound order tables are not available");
  });
});
