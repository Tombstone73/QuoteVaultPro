import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

import { registerInboundOrderRoutes } from "../routes/inboundOrders.routes";

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

function buildApp(service: Record<string, any>, options: { orgId?: string; internal?: boolean } = {}) {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "staff@example.com" };
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
    applyReviewAction: jest.fn(),
    saveReviewSnapshot: jest.fn(),
    getQuoteDraftPreview: jest.fn(),
    matchCustomer: jest.fn(),
    matchLineItemProduct: jest.fn(),
    resolveWarning: jest.fn(),
    resolveDecisionFlag: jest.fn(),
    createQuoteDraftFromInbound: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
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

  test("blocks draft conversion during phase 1", async () => {
    const response = await request(buildApp(service))
      .post("/api/inbound-orders/inbound_1/create-quote-draft")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("Phase 1 is review-only");
    expect(service.createQuoteDraftFromInbound).not.toHaveBeenCalled();
  });

  test("fails softly when inbound tables are not migrated", async () => {
    service.listInboundOrders.mockRejectedValue(new Error('relation "inbound_order_records" does not exist'));

    const response = await request(buildApp(service)).get("/api/inbound-orders");

    expect(response.status).toBe(503);
    expect(response.body.message).toContain("Inbound order tables are not available");
  });
});
