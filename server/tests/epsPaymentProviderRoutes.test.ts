import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const createHostedSession = jest.fn<(...args: any[]) => Promise<any>>();
const getPaymentSettings = jest.fn<(...args: any[]) => Promise<any>>();
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
  updatePaymentSettings,
  PaymentProviderError: MockPaymentProviderError,
}));

let registerPaymentProviderRoutes: any;

beforeAll(async () => {
  const routeModule = await import("../routes/paymentProvider.routes");
  registerPaymentProviderRoutes = routeModule.registerPaymentProviderRoutes;
});

function buildApp() {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "admin@example.com", role: "admin" };
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
});
