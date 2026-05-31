import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";

import { db, pool } from "../../server/db";
import {
  customerContacts,
  customers,
  invoiceEmailLogs,
  invoiceLineItems,
  invoices,
  orders,
  payments,
  organizations,
  products,
  users,
} from "../../shared/schema";

export const INVOICE_SMOKE_CUSTOMER_NAME = "Portal Test Customer";
export const INVOICE_SMOKE_CONTACT_FIRST_NAME = "Test Billing";
export const INVOICE_SMOKE_CONTACT_LAST_NAME = "Contact";
export const INVOICE_SMOKE_PO_NUMBER = "TEST-PO-INVOICE-SMOKE";
export const INVOICE_SMOKE_ORDER_NAME = "Invoice Smoke Test Order";
export const INVOICE_SMOKE_ORDER_NUMBER_PREFIX = "ORD-INVOICE-SMOKE";
const TEST_CUSTOMER_NAME = INVOICE_SMOKE_CUSTOMER_NAME;
const TEST_CONTACT_FIRST_NAME = INVOICE_SMOKE_CONTACT_FIRST_NAME;
const TEST_CONTACT_LAST_NAME = INVOICE_SMOKE_CONTACT_LAST_NAME;
const TEST_PRODUCT_NAME = "TEST PRODUCT - Invoice Smoke Fixture";
const FIXTURE_NOTE_TAG = "invoice-smoke-fixture-v2";

export type InvoiceSmokeFixtureSlot = {
  key: string;
  status: "draft" | "finalized";
  label: string;
  totalCents: number;
};

export const INVOICE_SMOKE_FIXTURE_SLOTS: InvoiceSmokeFixtureSlot[] = [
  {
    key: "draft-a",
    status: "draft",
    label: `${INVOICE_SMOKE_ORDER_NAME} - Draft A`,
    totalCents: 10000,
  },
  {
    key: "draft-b",
    status: "draft",
    label: `${INVOICE_SMOKE_ORDER_NAME} - Draft B`,
    totalCents: 11000,
  },
  {
    key: "finalized-a",
    status: "finalized",
    label: `${INVOICE_SMOKE_ORDER_NAME} - Finalized A`,
    totalCents: 12500,
  },
];

type SeedConfig = {
  organizationId: string;
  userId: string;
  safeEmail: string;
  allowProduction: boolean;
  isProduction: boolean;
  dryRun: boolean;
};

function readFlag(name: string): boolean {
  return ["1", "true", "yes"].includes(String(process.env[name] || "").trim().toLowerCase());
}

function isSafeFixtureEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return Boolean(normalized) &&
    !normalized.includes("@eliteprintingindy.com") &&
    !normalized.includes("@titan-graphics.com") &&
    (
      normalized.includes("test") ||
      normalized.includes("smoke") ||
      normalized.includes("sandbox") ||
      normalized.endsWith(".test") ||
      normalized.endsWith(".invalid")
    );
}

export function getInvoiceSmokeSeedSafetyErrors(config: SeedConfig): string[] {
  const errors: string[] = [];
  if (!config.organizationId) errors.push("SMOKE_ORG_ID is required.");
  if (!config.userId) errors.push("SMOKE_USER_ID is required.");
  if (!config.safeEmail) errors.push("SMOKE_TEST_EMAIL is required.");
  if (!isSafeFixtureEmail(config.safeEmail)) {
    errors.push("SMOKE_TEST_EMAIL must clearly be a test/smoke/sandbox email and must not be a real customer domain.");
  }
  if (config.isProduction && !config.allowProduction) {
    errors.push("Production fixture seeding requires ALLOW_PRODUCTION_INVOICE_SMOKE_FIXTURE=1.");
  }
  return errors;
}

function parseConfig(): SeedConfig {
  return {
    organizationId: String(process.env.SMOKE_ORG_ID || "").trim(),
    userId: String(process.env.SMOKE_USER_ID || "").trim(),
    safeEmail: String(process.env.SMOKE_TEST_EMAIL || "").trim(),
    allowProduction: readFlag("ALLOW_PRODUCTION_INVOICE_SMOKE_FIXTURE"),
    isProduction: String(process.env.NODE_ENV || "").trim().toLowerCase() === "production",
    dryRun: process.argv.includes("--dry-run"),
  };
}

function money(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

async function nextInvoiceNumber(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ maxNumber: sql<number>`coalesce(max(coalesce(${invoices.numberCore}, ${invoices.invoiceNumber})), 0)::int` })
    .from(invoices)
    .where(eq(invoices.organizationId, organizationId));
  return Number(row?.maxNumber || 0) + 1;
}

async function ensureCustomer(config: SeedConfig) {
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.organizationId, config.organizationId), eq(customers.companyName, TEST_CUSTOMER_NAME)))
    .limit(1);

  const customer = existing ?? (
    await db
      .insert(customers)
      .values({
        organizationId: config.organizationId,
        companyName: TEST_CUSTOMER_NAME,
        customerType: "business",
        email: config.safeEmail,
        phone: "000-000-0000",
        billingStreet1: "DO NOT SEND - TEST FIXTURE",
        billingCity: "Test City",
        billingState: "TS",
        billingPostalCode: "00000",
        billingCountry: "US",
        notes: "Invoice smoke-test fixture. Safe internal email only.",
      } as any)
      .returning()
  )[0];

  if (existing && existing.email !== config.safeEmail) {
    await db
      .update(customers)
      .set({
        email: config.safeEmail,
        notes: "Invoice smoke-test fixture. Safe internal email only.",
        updatedAt: new Date(),
      } as any)
      .where(eq(customers.id, existing.id));
    (customer as any).email = config.safeEmail;
  }

  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customer.id), eq(customerContacts.email, config.safeEmail)))
    .limit(1);

  const safeContact = contact ?? (
    await db
      .insert(customerContacts)
      .values({
        customerId: customer.id,
        firstName: TEST_CONTACT_FIRST_NAME,
        lastName: TEST_CONTACT_LAST_NAME,
        email: config.safeEmail,
        phone: "000-000-0000",
        isPrimary: true,
        internalNotes: "Invoice smoke-test fixture contact. Do not replace with a customer email.",
        flags: ["invoice-smoke-test", "do-not-send-real-customer"],
      } as any)
      .returning()
  )[0];

  await db
    .update(customerContacts)
    .set({
      firstName: TEST_CONTACT_FIRST_NAME,
      lastName: TEST_CONTACT_LAST_NAME,
      email: config.safeEmail,
      isPrimary: true,
      internalNotes: "Invoice smoke-test fixture contact. Do not replace with a customer email.",
      flags: ["invoice-smoke-test", "do-not-send-real-customer"],
    } as any)
    .where(eq(customerContacts.id, safeContact.id));

  return { customer, contact: safeContact };
}

async function ensureProduct(config: SeedConfig) {
  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.organizationId, config.organizationId), eq(products.name, TEST_PRODUCT_NAME)))
    .limit(1);

  if (existing) return existing;

  return (
    await db
      .insert(products)
      .values({
        organizationId: config.organizationId,
        name: TEST_PRODUCT_NAME,
        description: "Safe invoice smoke-test line item",
        category: "Testing",
        pricingMode: "flat",
        isService: true,
        artworkPolicy: "not_required",
        requiresProductionJob: false,
        requiresProofApproval: false,
        isTaxable: false,
        isActive: true,
      } as any)
      .returning()
  )[0];
}

function smokeOrderNumber(slotKey: string): string {
  return `${INVOICE_SMOKE_ORDER_NUMBER_PREFIX}-${slotKey.toUpperCase()}`;
}

async function ensureSmokeOrder(input: {
  config: SeedConfig;
  customerId: string;
  contactId: string;
  slot: InvoiceSmokeFixtureSlot;
}) {
  const orderNumber = smokeOrderNumber(input.slot.key);
  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.organizationId, input.config.organizationId), eq(orders.orderNumber, orderNumber)))
    .limit(1);

  const values = {
    organizationId: input.config.organizationId,
    orderNumber,
    displayNumber: orderNumber,
    poNumber: INVOICE_SMOKE_PO_NUMBER,
    label: input.slot.label,
    customerId: input.customerId,
    contactId: input.contactId,
    status: "new",
    state: "open",
    billingStatus: "ready",
    subtotal: money(input.slot.totalCents),
    tax: "0.00",
    taxAmount: "0.00",
    taxableSubtotal: "0.00",
    total: money(input.slot.totalCents),
    discount: "0.00",
    createdByUserId: input.config.userId,
  } as any;

  if (existing) {
    const [order] = await db
      .update(orders)
      .set({ ...values, updatedAt: sql`now()` as any } as any)
      .where(eq(orders.id, existing.id))
      .returning();
    return order;
  }

  const [order] = await db
    .insert(orders)
    .values(values)
    .returning();
  return order;
}

async function ensureSmokeInvoice(input: {
  config: SeedConfig;
  customerId: string;
  productId: string;
  orderId: string;
  slot: InvoiceSmokeFixtureSlot;
}) {
  const [existing] = await db
    .select()
    .from(invoices)
    .where(and(
      eq(invoices.organizationId, input.config.organizationId),
      eq(invoices.orderId, input.orderId),
      eq(invoices.invoiceCreationSource, "manual"),
      eq(invoices.billingMilestone, input.slot.key),
    ))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  const issuedAt = input.slot.status === "finalized" ? new Date() : null;
  const invoiceValues = {
      organizationId: input.config.organizationId,
      orderId: input.orderId,
      customerId: input.customerId,
      status: input.slot.status,
      terms: "due_on_receipt",
      issuedAt,
      dueDate: input.slot.status === "finalized" ? new Date() : null,
      subtotal: money(input.slot.totalCents),
      tax: "0.00",
      total: money(input.slot.totalCents),
      subtotalCents: input.slot.totalCents,
      taxCents: 0,
      shippingCents: 0,
      totalCents: input.slot.totalCents,
      amountPaid: "0.00",
      balanceDue: money(input.slot.totalCents),
      notesInternal: `${FIXTURE_NOTE_TAG}. Safe to repair/recreate. Slot: ${input.slot.key}.`,
      notesPublic: "Test invoice fixture. No real customer billing.",
      createdByUserId: input.config.userId,
      syncStatus: "skipped",
      qbSyncStatus: "not_synced",
      qbLastError: null,
      lastSentAt: null,
      lastSentVersion: null,
      lastSentVia: null,
      invoiceCreationSource: "manual",
      billingMilestone: input.slot.key,
      updatedAt: new Date(),
    } as any;

  let invoice: any = existing;
  if (existing) {
    await db.delete(payments).where(and(eq(payments.organizationId, input.config.organizationId), eq(payments.invoiceId, existing.id)));
    await db.delete(invoiceEmailLogs).where(and(eq(invoiceEmailLogs.organizationId, input.config.organizationId), eq(invoiceEmailLogs.invoiceId, existing.id)));
    [invoice] = await db
      .update(invoices)
      .set(invoiceValues)
      .where(eq(invoices.id, existing.id))
      .returning();
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, existing.id));
  } else {
    const invoiceNumber = await nextInvoiceNumber(input.config.organizationId);
    [invoice] = await db
      .insert(invoices)
      .values({
        ...invoiceValues,
        invoiceNumber,
        displayNumber: `INV-${invoiceNumber}`,
        numberCore: invoiceNumber,
      } as any)
      .returning();
  }

  await db.insert(invoiceLineItems).values({
    invoiceId: invoice.id,
    productId: input.productId,
    productType: "test",
    name: TEST_PRODUCT_NAME,
    sku: "SMOKE-TEST",
    description: input.slot.label,
    quantity: 1,
    unitPrice: money(input.slot.totalCents),
    totalPrice: money(input.slot.totalCents),
    unitPriceCents: input.slot.totalCents,
    lineTotalCents: input.slot.totalCents,
    sortOrder: 0,
  } as any);

  return invoice;
}

async function main() {
  const config = parseConfig();
  const errors = getInvoiceSmokeSeedSafetyErrors(config);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, config.organizationId)).limit(1);
  if (!org) throw new Error(`Organization not found: ${config.organizationId}`);

  const [user] = await db.select().from(users).where(eq(users.id, config.userId)).limit(1);
  if (!user) throw new Error(`User not found: ${config.userId}`);

  if (config.dryRun) {
    console.log("Invoice smoke fixture dry run passed safety checks.");
    return;
  }

  const { customer, contact } = await ensureCustomer(config);
  const product = await ensureProduct(config);

  const rows = [];
  for (const slot of INVOICE_SMOKE_FIXTURE_SLOTS) {
    const order = await ensureSmokeOrder({
      config,
      customerId: customer.id,
      contactId: contact.id,
      slot,
    });
    const invoice = await ensureSmokeInvoice({
      config,
      customerId: customer.id,
      productId: product.id,
      orderId: order.id,
      slot,
    });
    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.displayNumber || `INV-${invoice.invoiceNumber}`,
      status: invoice.status,
      orderNumber: order.displayNumber || order.orderNumber,
      jobName: order.label,
      poNumber: order.poNumber,
    });
  }

  console.log(JSON.stringify({
    customer: TEST_CUSTOMER_NAME,
    contact: `${TEST_CONTACT_FIRST_NAME} ${TEST_CONTACT_LAST_NAME}`,
    contactEmail: config.safeEmail,
    invoices: rows,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main()
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}
