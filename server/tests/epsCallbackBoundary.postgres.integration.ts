import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, customerPaymentBatches, customers, invoices, organizations, payments, users } from "@shared/schema";
import { EPS_CALLBACK_PATH, registerEpsCallbackRoutes } from "../routes/epsCallback.routes";

// This proves non-posting on the actual migrated PostgreSQL schema. These
// hostile payloads are NOT asserted to be the undocumented EPS callback format.
const orgIds: string[] = [];
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
let actor: string;
const app = express();
app.set("trust proxy", 1);
registerEpsCallbackRoutes(app);
app.use(express.json({ limit: "5mb" }));

beforeAll(async () => {
  actor = (await db.insert(users).values({ email: randomUUID() + "@example.invalid", role: "admin" }).returning())[0].id;
  for (let index = 0; index < 2; index++) {
    const org = (await db.insert(organizations).values({ name: "Synthetic EPS callback boundary", slug: "eps-" + randomUUID() }).returning())[0];
    orgIds.push(org.id);
    const customer = (await db.insert(customers).values({ organizationId: org.id, companyName: "Synthetic EPS payer" }).returning())[0];
    const invoice = (await db.insert(invoices).values({ organizationId: org.id, customerId: customer.id, invoiceNumber: 1, displayNumber: "EPS-1", createdByUserId: actor,
      status: "billed", subtotal: "100.00", tax: "0.00", total: "100.00", subtotalCents: 10000, taxCents: 0, totalCents: 10000 }).returning())[0];
    invoiceIds.push(invoice.id);
    const payment = (await db.insert(payments).values({ organizationId: org.id, invoiceId: invoice.id, provider: "eps", status: "pending", amount: "100.00", amountCents: 10000,
      currency: "USD", epsMode: "hosted_cnp", epsPtk: "synthetic-ptk-" + index, providerIdempotencyKey: "synthetic-eps-" + randomUUID(), method: "credit_card", createdByUserId: actor }).returning())[0];
    paymentIds.push(payment.id);
  }
}, 180000);

afterAll(async () => {
  if (orgIds.length) {
    await db.delete(payments).where(inArray(payments.organizationId, orgIds));
    await db.delete(invoices).where(inArray(invoices.organizationId, orgIds));
    await db.delete(customers).where(inArray(customers.organizationId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (actor) await db.delete(users).where(inArray(users.id, [actor]));
});

async function snapshot() {
  return {
    payments: await db.select().from(payments).where(inArray(payments.organizationId, orgIds)).orderBy(payments.id),
    invoices: await db.select().from(invoices).where(inArray(invoices.organizationId, orgIds)).orderBy(invoices.id),
    receipts: await db.select().from(customerPaymentBatches).where(inArray(customerPaymentBatches.organizationId, orgIds)).orderBy(customerPaymentBatches.id),
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.organizationId, orgIds)).orderBy(auditLogs.id),
  };
}

test("unverified approvals, declines, duplicates, retries, mismatches and foreign tenant claims preserve actual payment/invoice rows", async () => {
  const before = await snapshot();
  const approvedLooking = { paymentId: paymentIds[0], organizationId: orgIds[0], TransactionResult: true, TransactionID: "synthetic-eps-transaction", ApprovedAmount: "100.00", currency: "USD" };
  const attempts = [
    approvedLooking, approvedLooking, { ...approvedLooking, status: "pending" }, { ...approvedLooking, TransactionResult: false },
    approvedLooking, { ...approvedLooking, paymentId: "unknown" }, { ...approvedLooking, ApprovedAmount: "999.00" },
    { ...approvedLooking, currency: "EUR" }, { ...approvedLooking, BusinessId: "wrong-merchant" },
    { ...approvedLooking, paymentId: paymentIds[1], organizationId: orgIds[0] },
  ];
  for (const body of attempts) {
    const response = await request(app).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").send(body);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("EPS_CALLBACK_VERIFICATION_UNAVAILABLE");
    expect(await snapshot()).toEqual(before);
  }
  expect(before.payments.map(payment => payment.status)).toEqual(["pending", "pending"]);
});

test("browser success return before callback and malformed callback leave canonical balances and receipt identity unchanged", async () => {
  const before = await snapshot();
  expect((await request(app).get(EPS_CALLBACK_PATH + "?success=true&paymentId=" + paymentIds[0])).status).toBe(405);
  expect((await request(app).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").type("json").send('{"TransactionResult":true,')).status).toBe(400);
  expect(await snapshot()).toEqual(before);
});
