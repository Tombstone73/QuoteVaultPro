import { beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { customerPortalAccess, customers, invoices, organizations, payments, users } from "@shared/schema";
import { safeTestDatabaseUrl } from "./helpers/safeTestDatabase";

const testUrl = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
if (!testUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(testUrl).hostname)
  || testUrl !== process.env.DATABASE_URL) throw new Error("Invoice availability tests require the disposable loopback PostgreSQL runner.");

const runtime = jest.fn<(...args: unknown[]) => Promise<any>>();
jest.unstable_mockModule("../services/stripeRuntimeConfig.service", () => ({ resolveStripeRuntimeConfig: runtime }));
const portal = await import("../services/portal.service");
const guest = await import("../services/guestInvoicePayment.service");
const ids = { org: randomUUID(), otherOrg: randomUUID(), customer: randomUUID(), otherCustomer: randomUUID(), user: randomUUID(), invoice: randomUUID(), access: randomUUID() };
let customer: any;
let access: any;
const req = (patch: Record<string, unknown> = {}) => ({ organizationId: ids.org, portalCustomerId: ids.customer, portalCustomer: customer,
  user: { id: ids.user }, portalAccess: access, body: {}, ...patch } as any);

beforeAll(async () => {
  await db.insert(users).values({ id: ids.user, email: `${ids.user}@example.invalid` });
  await db.insert(organizations).values([{ id: ids.org, name: "Synthetic Invoice Availability", slug: ids.org }, { id: ids.otherOrg, name: "Other tenant", slug: ids.otherOrg }]);
  [customer] = await db.insert(customers).values({ id: ids.customer, organizationId: ids.org, companyName: "Synthetic Anomaly Promotional" }).returning();
  await db.insert(customers).values({ id: ids.otherCustomer, organizationId: ids.org, companyName: "Other customer" });
  [access] = await db.insert(customerPortalAccess).values({ id: ids.access, organizationId: ids.org, customerId: ids.customer, userId: ids.user, email: `${ids.user}@example.invalid`, status: "ACTIVE", accessRole: "BILLING" }).returning();
  await db.insert(invoices).values({ id: ids.invoice, organizationId: ids.org, customerId: ids.customer, invoiceNumber: 20972, createdByUserId: ids.user,
    status: "billed", customerReleasedAt: new Date(), subtotal: "125.70", tax: "0.00", total: "125.70", subtotalCents: 12570, taxCents: 0, totalCents: 12570 });
});

beforeEach(async () => {
  runtime.mockReset().mockResolvedValue({ ok: true, data: { provider: "stripe", readyForPayments: true, connectedAccountId: "acct_fixture" } });
  await db.delete(payments).where(eq(payments.invoiceId, ids.invoice));
  await db.update(invoices).set({ status: "billed", customerReleasedAt: new Date(), accountingApprovedAt: null, accountingApprovedVersion: null }).where(eq(invoices.id, ids.invoice));
});

test("authorized synthetic 20972 is payable without an email and reads do not change its records", async () => {
  const before = await db.select().from(invoices).where(eq(invoices.id, ids.invoice));
  expect(await portal.getPortalInvoice(req(), ids.invoice)).toMatchObject({ amountDue: 125.70, paymentEligibility: { payable: true } });
  expect(await portal.listPortalInvoices(req())).toMatchObject([{ id: ids.invoice, paymentEligibility: { payable: true } }]);
  expect(await db.select().from(invoices).where(eq(invoices.id, ids.invoice))).toEqual(before);
  expect(await db.select().from(payments).where(eq(payments.organizationId, ids.org))).toEqual([]);
});

test("version-matched approval also permits payment without release or email", async () => {
  await db.update(invoices).set({ customerReleasedAt: null, accountingApprovedAt: new Date(), accountingApprovedVersion: 1, invoiceVersion: 1 }).where(eq(invoices.id, ids.invoice));
  expect(await portal.getPortalInvoice(req(), ids.invoice)).toMatchObject({ paymentEligibility: { payable: true } });
});

test("viewer and staff preview cannot produce a false enabled customer Pay action", async () => {
  const viewer = req({ portalAccess: { ...access, accessRole: "VIEWER" } });
  expect(await portal.getPortalInvoice(viewer, ids.invoice)).toMatchObject({ paymentEligibility: { payable: false, reasonCode: "CUSTOMER_ACCESS_DENIED" } });
  await expect(portal.createPortalStripePaymentIntent(viewer, ids.invoice)).rejects.toMatchObject({ statusCode: 403 });
  const preview = req({ staffPortalPreview: { actorUserId: ids.user } });
  expect(await portal.getPortalInvoice(preview, ids.invoice)).toMatchObject({ paymentEligibility: { payable: false, reasonCode: "CUSTOMER_ACCESS_UNVERIFIED" } });
  await expect(portal.createPortalStripePaymentIntent(preview, ids.invoice)).rejects.toMatchObject({ statusCode: 403 });
  expect(runtime).not.toHaveBeenCalled();
});

test("other tenant/customer and unapproved invoice remain inaccessible", async () => {
  expect(await portal.getPortalInvoice(req({ organizationId: ids.otherOrg, portalCustomer: { ...customer, organizationId: ids.otherOrg } }), ids.invoice)).toBeNull();
  expect(await portal.getPortalInvoice(req({ portalCustomerId: ids.otherCustomer, portalCustomer: { ...customer, id: ids.otherCustomer } }), ids.invoice)).toBeNull();
  await db.update(invoices).set({ customerReleasedAt: null }).where(eq(invoices.id, ids.invoice));
  expect(await portal.getPortalInvoice(req(), ids.invoice)).toBeNull();
});

test("provider configuration blocks display and runtime without exposing credentials", async () => {
  runtime.mockResolvedValue({ ok: false, code: "STRIPE_NOT_ENABLED", error: "Sensitive internal provider detail" });
  const dto = await portal.getPortalInvoice(req(), ids.invoice);
  expect(dto?.paymentEligibility).toMatchObject({ payable: false, reasonCode: "PROVIDER_UNAVAILABLE" });
  expect(JSON.stringify(dto)).not.toContain("Sensitive internal");
  await expect(portal.getPortalStripeRuntimeConfig(req(), ids.invoice)).rejects.toThrow("Please contact the shop");
});

test("partial balances remain payable; zero and void balances do not", async () => {
  await db.insert(payments).values({ organizationId: ids.org, invoiceId: ids.invoice, provider: "manual", method: "cash", status: "succeeded", amount: "25.70", amountCents: 2570, createdByUserId: ids.user });
  expect(await portal.getPortalInvoice(req(), ids.invoice)).toMatchObject({ amountDue: 100, paymentEligibility: { payable: true } });
  await db.update(payments).set({ amount: "125.70", amountCents: 12570 }).where(eq(payments.invoiceId, ids.invoice));
  expect(await portal.getPortalInvoice(req(), ids.invoice)).toMatchObject({ amountDue: 0, paymentEligibility: { payable: false } });
  await db.update(invoices).set({ status: "void" }).where(eq(invoices.id, ids.invoice));
  expect(await portal.getPortalInvoice(req(), ids.invoice)).toMatchObject({ paymentEligibility: { payable: false } });
});

test("verified guest link shares availability without requiring an email send", async () => {
  const token = await guest.issueGuestInvoicePaymentToken({ organizationId: ids.org, invoiceId: ids.invoice, createdByUserId: ids.user });
  expect(await guest.getGuestInvoice(token)).toMatchObject({ amountDue: 125.70, paymentEligibility: { payable: true } });
  expect(await guest.getGuestInvoice("invalid-fixture-token")).toBeNull();
});
