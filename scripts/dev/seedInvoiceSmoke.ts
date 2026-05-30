import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "../../server/db";
import {
  customerContacts,
  customers,
  invoiceLineItems,
  invoices,
  orders,
  organizations,
  products,
  users,
} from "../../shared/schema";

const TEST_CUSTOMER_NAME = "TEST CUSTOMER - DO NOT SEND";
const TEST_CONTACT_FIRST_NAME = "Invoice";
const TEST_CONTACT_LAST_NAME = "Smoke Test";
const TEST_PRODUCT_NAME = "TEST PRODUCT - Invoice Smoke Fixture";

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

async function createSmokeInvoice(input: {
  config: SeedConfig;
  customerId: string;
  contactId: string;
  productId: string;
  status: "draft" | "finalized";
  label: string;
  totalCents: number;
}) {
  const runId = Date.now();
  const orderNumber = `SMOKE-${runId}-${input.status.toUpperCase()}`;
  const [order] = await db
    .insert(orders)
    .values({
      organizationId: input.config.organizationId,
      orderNumber,
      displayNumber: orderNumber,
      poNumber: `PO-SMOKE-${runId}`,
      label: input.label,
      customerId: input.customerId,
      contactId: input.contactId,
      status: "new",
      state: "open",
      billingStatus: "ready",
      subtotal: money(input.totalCents),
      tax: "0.00",
      taxAmount: "0.00",
      taxableSubtotal: "0.00",
      total: money(input.totalCents),
      discount: "0.00",
      createdByUserId: input.config.userId,
    } as any)
    .returning();

  const invoiceNumber = await nextInvoiceNumber(input.config.organizationId);
  const issuedAt = input.status === "finalized" ? new Date() : null;
  const [invoice] = await db
    .insert(invoices)
    .values({
      organizationId: input.config.organizationId,
      invoiceNumber,
      displayNumber: `INV-${invoiceNumber}`,
      numberCore: invoiceNumber,
      orderId: order.id,
      customerId: input.customerId,
      status: input.status,
      terms: "due_on_receipt",
      issuedAt,
      dueDate: new Date(),
      subtotal: money(input.totalCents),
      tax: "0.00",
      total: money(input.totalCents),
      subtotalCents: input.totalCents,
      taxCents: 0,
      shippingCents: 0,
      totalCents: input.totalCents,
      amountPaid: "0.00",
      balanceDue: money(input.totalCents),
      notesInternal: "Invoice smoke-test fixture. Safe to finalize/send/pay during validation.",
      notesPublic: "Test invoice fixture. No real customer billing.",
      createdByUserId: input.config.userId,
      syncStatus: "skipped",
      qbSyncStatus: "not_synced",
    } as any)
    .returning();

  await db.insert(invoiceLineItems).values({
    invoiceId: invoice.id,
    productId: input.productId,
    productType: "test",
    name: TEST_PRODUCT_NAME,
    sku: "SMOKE-TEST",
    description: input.label,
    quantity: 1,
    unitPrice: money(input.totalCents),
    totalPrice: money(input.totalCents),
    unitPriceCents: input.totalCents,
    lineTotalCents: input.totalCents,
    sortOrder: 0,
  } as any);

  return { order, invoice };
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

  const draft = await createSmokeInvoice({
    config,
    customerId: customer.id,
    contactId: contact.id,
    productId: product.id,
    status: "draft",
    label: "Invoice Smoke Draft - safe finalize/send/pay",
    totalCents: 10000,
  });

  const finalized = await createSmokeInvoice({
    config,
    customerId: customer.id,
    contactId: contact.id,
    productId: product.id,
    status: "finalized",
    label: "Invoice Smoke Finalized - safe batch send",
    totalCents: 12500,
  });

  const rows = [draft, finalized].map(({ invoice, order }) => ({
    invoiceId: invoice.id,
    invoiceNumber: invoice.displayNumber || `INV-${invoice.invoiceNumber}`,
    status: invoice.status,
    orderNumber: order.displayNumber || order.orderNumber,
    poNumber: order.poNumber,
  }));

  console.log(JSON.stringify({
    customer: TEST_CUSTOMER_NAME,
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
