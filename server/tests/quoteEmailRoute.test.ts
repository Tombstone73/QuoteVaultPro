import { beforeEach, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { markInvoiceEmailDeliveryFailure } from "../services/invoiceEmailDeliveryFailure";

const quote = { id: "quote", revision: 3, displayNumber: "QT-123", customerId: "customer" };
const getQuoteById = jest.fn<(organizationId: string, quoteId: string) => Promise<typeof quote | null>>();
const sendQuoteEmail = jest.fn<() => Promise<string>>();
const auditValues = jest.fn(async (_entry: unknown) => []);
jest.unstable_mockModule("../storage", () => ({ storage: {
  getQuoteById, getCustomerContacts: jest.fn(), getCompanySettings: jest.fn(),
  updateCustomerContactForOrganization: jest.fn(), createCustomerContactForOrganization: jest.fn(),
} }));
jest.unstable_mockModule("../db", () => ({ db: { insert: () => ({ values: auditValues }) } }));
jest.unstable_mockModule("../emailService", () => ({ emailService: { sendQuoteEmail } }));
jest.unstable_mockModule("../tenantContext", () => ({ getRequestOrganizationId: (req: { organizationId: string }) => req.organizationId }));
const { registerEmailRoutes } = await import("../routes/email.routes");

function app() {
  const server = express();
  server.use(express.json());
  registerEmailRoutes(server, {
    isAuthenticated: (req: any, res: any, next: () => void) => {
      if (req.get("x-test-auth") === "no") return res.status(401).end();
      req.user = { id: "staff" };
      next();
    },
    tenantContext: (req: any, _res: unknown, next: () => void) => {
      req.organizationId = req.get("x-test-tenant") ?? "tenant";
      req.orgRole = "employee";
      next();
    },
    isAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  });
  return server;
}

const path = "/api/quotes/quote/email";
const payload = { recipients: { to: ["one@example.com", "two@example.com"] }, attachPdf: false };

beforeEach(() => {
  jest.clearAllMocks();
  getQuoteById.mockImplementation(async organizationId => organizationId === "tenant" ? quote : null);
  sendQuoteEmail.mockResolvedValue("gmail-receipt");
});

test("concurrent and repeated submissions of the same Quote request send exactly one message", async () => {
  const server = app();
  const send = () => request(server).post(path).set("Idempotency-Key", "attempt-1").send(payload);
  const responses = await Promise.all([send(), send()]);
  responses.push(await send());
  expect(responses.map(response => [response.status, response.body.providerMessageId])).toEqual(Array(3).fill([200, "gmail-receipt"]));
  expect(sendQuoteEmail).toHaveBeenCalledTimes(1);
  expect(auditValues).toHaveBeenCalledTimes(2);
  const changed = await request(server).post(path).set("Idempotency-Key", "attempt-1").send({ ...payload, subject: "Different draft" });
  expect(changed.status).toBe(409);
});

test("an unconfirmed Gmail submission is replayed without sending again", async () => {
  const server = app();
  sendQuoteEmail.mockRejectedValue(markInvoiceEmailDeliveryFailure(new Error("timeout"), "needs_review"));
  const send = () => request(server).post(path).set("Idempotency-Key", "attempt-2").send(payload);
  const first = await send();
  const repeated = await send();
  expect(first.status).toBe(500);
  expect(repeated.body).toEqual(first.body);
  expect(repeated.body.code).toBe("EMAIL_DELIVERY_UNCONFIRMED");
  expect(sendQuoteEmail).toHaveBeenCalledTimes(1);
  expect(auditValues).toHaveBeenCalledTimes(1);
});

test("requires authentication and resolves the quote in the actor's tenant", async () => {
  const server = app();
  expect((await request(server).post(path).set("x-test-auth", "no").send(payload)).status).toBe(401);
  expect((await request(server).post(path).set("x-test-tenant", "other").send(payload)).status).toBe(404);
  expect(getQuoteById).toHaveBeenCalledTimes(1);
  expect(getQuoteById).toHaveBeenCalledWith("other", "quote", undefined);
  expect(sendQuoteEmail).not.toHaveBeenCalled();
  expect(auditValues).not.toHaveBeenCalled();
});
