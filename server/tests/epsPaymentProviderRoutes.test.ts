import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const createHostedSession = jest.fn<(...args: any[]) => Promise<any>>();
const getPaymentSettings = jest.fn<(...args: any[]) => Promise<any>>();
const recordHostedResult = jest.fn<(...args: any[]) => Promise<any>>();
const updatePaymentSettings = jest.fn<(...args: any[]) => Promise<any>>();

class MockPaymentProviderError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code = "PAYMENT_PROVIDER_ERROR", statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

jest.unstable_mockModule("../services/payments/paymentProvider.service", () => ({
  createHostedSession,
  getPaymentSettings,
  recordHostedResult,
  updatePaymentSettings,
  PaymentProviderError: MockPaymentProviderError,
}));

let registerPaymentProviderRoutes: any;

beforeAll(async () => {
  const routeModule = await import("../routes/paymentProvider.routes");
  registerPaymentProviderRoutes = routeModule.registerPaymentProviderRoutes;
});

function buildApp(user: Record<string, any> = { id: "user_1", email: "admin@example.com", role: "admin" }) {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = user;
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = "org_1";
    next();
  };
  const isAdminOrOwner = (_req: any, _res: any, next: any) => next();
  registerPaymentProviderRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner });
  return app;
}

describe("EPS payment provider routes Phase 1", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ["/api/payments/eps/token-sale", { token: "tok_secret_1234", expirationDate: "12/29" }],
    ["/api/payments/eps/card-present-sale", { deviceSerialNumber: "terminal_1" }],
    ["/api/payments/eps/ach-sale", { checkAccount: "123456789", checkRouting: "021000021" }],
    ["/api/payments/eps/gift-card-sale", { giftCardToken: "gift_secret_1234" }],
    ["/api/payments/eps/void", { providerTransactionId: "txn_1" }],
    ["/api/payments/eps/refund", { providerTransactionId: "txn_1", amountCents: 1000 }],
    ["/api/payments/eps/capture", { providerTransactionId: "txn_1", amountCents: 1000 }],
    ["/api/payments/eps/close-batch", { idempotencyKey: "close-batch-1" }],
  ])("%s is hard-disabled and does not call EPS service paths", async (path, extraBody) => {
    const app = buildApp();
    const response = await request(app)
      .post(path)
      .send({
        invoiceId: "invoice_1",
        amountCents: 1000,
        idempotencyKey: "idempotency-1",
        ...extraBody,
      });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({
      success: false,
      code: "EPS_PHASE1_DISABLED",
      data: { enabledPhase1Modes: ["hosted_cnp"] },
    });
    expect(response.body.error).toContain("requires EPS certification documentation");
    expect(createHostedSession).not.toHaveBeenCalled();
    expect(getPaymentSettings).not.toHaveBeenCalled();
    expect(recordHostedResult).not.toHaveBeenCalled();
    expect(updatePaymentSettings).not.toHaveBeenCalled();
  });

  test("hosted-session remains enabled and returns a pending payment", async () => {
    createHostedSession.mockResolvedValueOnce({
      payment: {
        id: "payment_1",
        provider: "eps",
        status: "pending",
        epsMode: "hosted_cnp",
        amountCents: 2500,
        epsHostedPaymentUrl: "https://postransactions.com/cnp/cnp?ptk=ptk_123",
      },
      response: {
        approved: false,
        pending: true,
        status: "pending",
        ptk: "ptk_123",
        responseMessage: "PTK Stored",
      },
      hostedPaymentUrl: "https://postransactions.com/cnp/cnp?ptk=ptk_123",
    });

    const response = await request(buildApp())
      .post("/api/payments/eps/hosted-session")
      .send({ invoiceId: "invoice_1", amountCents: 2500, idempotencyKey: "hosted-1" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        payment: { provider: "eps", status: "pending", epsMode: "hosted_cnp" },
        response: { pending: true, status: "pending" },
      },
    });
    expect(createHostedSession).toHaveBeenCalledTimes(1);
    expect(createHostedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        invoiceId: "invoice_1",
        amountCents: 2500,
      }),
    );
  });

  test("payment settings responses never include the EPS API key", async () => {
    getPaymentSettings.mockResolvedValueOnce({
      provider: "eps",
      epsEnabled: true,
      epsAccountNumber: "1661825323",
      epsApiKeyConfigured: true,
      epsCnpBaseUrl: "https://postransactions.com/cnp",
      epsSupportedModes: ["hosted_cnp"],
      epsReady: true,
      missing: [],
    });

    const response = await request(buildApp()).get("/api/payment-settings");

    expect(response.status).toBe(200);
    expect(response.body.data.epsApiKey).toBeUndefined();
    expect(response.body.data.epsApiKeyConfigured).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  test("settings patch forces EPS Phase 1 hosted-only supported modes", async () => {
    updatePaymentSettings.mockResolvedValueOnce({
      provider: "eps",
      epsEnabled: true,
      epsSupportedModes: ["hosted_cnp"],
      epsApiKeyConfigured: true,
      epsReady: true,
      missing: [],
    });

    const response = await request(buildApp())
      .patch("/api/payment-settings")
      .send({
        provider: "eps",
        epsEnabled: true,
        epsSupportedModes: ["token_cnp", "ach", "card_present", "gift_card"],
      });

    expect(response.status).toBe(200);
    expect(updatePaymentSettings).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ epsSupportedModes: ["hosted_cnp"] }),
    );
    expect(response.body.data.epsSupportedModes).toEqual(["hosted_cnp"]);
  });

  test("record-hosted-result is staff/admin-only", async () => {
    const response = await request(buildApp({ id: "customer_1", email: "customer@example.com", role: "customer" }))
      .post("/api/payments/eps/record-hosted-result")
      .send({
        paymentId: "payment_1",
        epsTransactionId: "txn_1",
        approvedAmountCents: 2500,
        result: "approved",
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      code: "PAYMENT_PERMISSION_REQUIRED",
    });
    expect(recordHostedResult).not.toHaveBeenCalled();
  });

  test("record-hosted-result records approved portal results without exposing secrets", async () => {
    recordHostedResult.mockResolvedValueOnce({
      payment: {
        id: "payment_1",
        provider: "eps",
        status: "captured",
        epsMode: "hosted_cnp",
        providerTransactionId: "txn_123",
        epsAuthCode: "AUTH1",
        amountCents: 2500,
      },
      invoice: { id: "invoice_1", status: "paid" },
      response: {
        approved: true,
        pending: false,
        status: "approved",
        providerTransactionId: "txn_123",
        authCode: "AUTH1",
      },
    });

    const response = await request(buildApp())
      .post("/api/payments/eps/record-hosted-result")
      .send({
        paymentId: "payment_1",
        epsTransactionId: "txn_123",
        authCode: "AUTH1",
        approvedAmountCents: 2500,
        responseCode: "A0000",
        responseMessage: "Approved",
        result: "approved",
      });

    expect(response.status).toBe(200);
    expect(recordHostedResult).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        paymentId: "payment_1",
        epsTransactionId: "txn_123",
        approvedAmountCents: 2500,
        result: "approved",
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("apikey");
    expect(JSON.stringify(response.body)).not.toContain("cvv");
    expect(JSON.stringify(response.body)).not.toContain("ptk_secret");
  });

  test("record-hosted-result rejects duplicate EPS transaction ids with safe envelope", async () => {
    recordHostedResult.mockRejectedValueOnce(
      new MockPaymentProviderError("This EPS transaction id has already been recorded.", "EPS_TRANSACTION_DUPLICATE", 409),
    );

    const response = await request(buildApp())
      .post("/api/payments/eps/record-hosted-result")
      .send({
        paymentId: "payment_1",
        epsTransactionId: "txn_duplicate",
        approvedAmountCents: 2500,
        result: "approved",
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "EPS_TRANSACTION_DUPLICATE",
    });
  });

  test("record-hosted-result returns safe amount-mismatch errors", async () => {
    recordHostedResult.mockRejectedValueOnce(
      new MockPaymentProviderError(
        "Approved amount must match the pending EPS payment amount unless amountOverride is explicitly true.",
        "EPS_AMOUNT_MISMATCH",
        409,
      ),
    );

    const response = await request(buildApp())
      .post("/api/payments/eps/record-hosted-result")
      .send({
        paymentId: "payment_1",
        epsTransactionId: "txn_amount_mismatch",
        approvedAmountCents: 2400,
        result: "approved",
        amountOverride: false,
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "EPS_AMOUNT_MISMATCH",
    });
  });

  test("record-hosted-result forwards explicit amount override", async () => {
    recordHostedResult.mockResolvedValueOnce({
      payment: {
        id: "payment_1",
        provider: "eps",
        status: "captured",
        epsMode: "hosted_cnp",
        providerTransactionId: "txn_override",
        amountCents: 2400,
      },
      invoice: { id: "invoice_1", status: "partially_paid" },
      response: { approved: true, pending: false, status: "approved" },
    });

    const response = await request(buildApp())
      .post("/api/payments/eps/record-hosted-result")
      .send({
        paymentId: "payment_1",
        epsTransactionId: "txn_override",
        approvedAmountCents: 2400,
        result: "approved",
        amountOverride: true,
      });

    expect(response.status).toBe(200);
    expect(recordHostedResult).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedAmountCents: 2400,
        amountOverride: true,
      }),
    );
  });

  test("record-hosted-result strips sensitive payment instrument fields before service call", async () => {
    recordHostedResult.mockResolvedValueOnce({
      payment: { id: "payment_1", provider: "eps", status: "failed", epsMode: "hosted_cnp", amountCents: 2500 },
      invoice: { id: "invoice_1", status: "billed" },
      response: { approved: false, pending: false, status: "failed" },
    });

    const response = await request(buildApp())
      .post("/api/payments/eps/record-hosted-result")
      .send({
        paymentId: "payment_1",
        epsTransactionId: "txn_failed",
        approvedAmountCents: 0,
        result: "failed",
        cardNumber: "4111111111111111",
        cvv: "123",
        token: "tok_secret",
        expirationDate: "12/29",
      });

    expect(response.status).toBe(200);
    const servicePayload = recordHostedResult.mock.calls[0][0];
    expect(servicePayload.cardNumber).toBeUndefined();
    expect(servicePayload.cvv).toBeUndefined();
    expect(servicePayload.token).toBeUndefined();
    expect(servicePayload.expirationDate).toBeUndefined();
  });
});
