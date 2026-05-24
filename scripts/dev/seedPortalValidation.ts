import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, inArray, ne } from "drizzle-orm";

import { db, pool } from "../../server/db";
import { refreshInvoiceStatus } from "../../server/invoicesService";
import {
  getPortalValidationSeedSafetyErrors,
  parsePortalValidationSeedConfig,
} from "../../server/lib/portalValidationSeedConfig";
import {
  authIdentities,
  customers,
  invoiceLineItems,
  invoices,
  organizations,
  payments,
  products,
  users,
} from "../../shared/schema";

function money(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function ensureUser(config: ReturnType<typeof parsePortalValidationSeedConfig>) {
  const passwordHash = await bcrypt.hash(config.password, 12);
  const [existing] = await db.select().from(users).where(eq(users.email, config.email)).limit(1);

  const user = existing
    ? (
        await db
          .update(users)
          .set({
            firstName: existing.firstName || "Portal",
            lastName: existing.lastName || "Validation",
            mustSetPassword: false,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(users)
          .values({
            id: config.userId,
            email: config.email,
            firstName: "Portal",
            lastName: "Validation",
            role: "employee",
            isAdmin: false,
            isPlatformAdmin: false,
            isPlatformDeveloper: false,
            mustSetPassword: false,
          } as any)
          .returning()
      )[0];

  await db
    .insert(authIdentities)
    .values({
      userId: user.id,
      provider: "password",
      passwordHash,
      passwordSetAt: new Date(),
    } as any)
    .onConflictDoUpdate({
      target: [authIdentities.userId, authIdentities.provider],
      set: {
        passwordHash,
        passwordSetAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return user;
}

async function upsertProduct(config: ReturnType<typeof parsePortalValidationSeedConfig>) {
  const values = {
    id: config.productId,
    organizationId: config.organizationId,
    name: "Portal Validation Line Item",
    description: "DEV-only product used by the customer portal validation seed.",
    productTypeId: null,
    pricingFormula: null,
    category: "Validation",
    isActive: true,
    updatedAt: new Date(),
  } as any;

  await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({
      target: products.id,
      set: values,
    });
}

async function upsertInvoice(params: {
  id: string;
  invoiceNumber: number;
  status: string;
  config: ReturnType<typeof parsePortalValidationSeedConfig>;
  userId: string;
  issueDate: Date;
  dueDate: Date | null;
}) {
  const totalCents = params.config.invoiceAmountCents;
  const values = {
    id: params.id,
    organizationId: params.config.organizationId,
    invoiceNumber: params.invoiceNumber,
    customerId: params.config.customerId,
    status: params.status,
    terms: "net_30",
    issueDate: params.issueDate,
    issuedAt: params.status === "draft" ? null : params.issueDate,
    dueDate: params.dueDate,
    subtotal: money(totalCents),
    tax: "0.00",
    total: money(totalCents),
    subtotalCents: totalCents,
    taxCents: 0,
    shippingCents: 0,
    totalCents,
    currency: "USD",
    amountPaid: "0.00",
    balanceDue: money(totalCents),
    notesPublic: "DEV portal validation invoice.",
    notesInternal: "DEV-only portal validation seed. Safe to repair/recreate.",
    createdByUserId: params.userId,
    syncStatus: "skipped",
    qbSyncStatus: "pending",
    isHistorical: false,
    importSource: null,
    lockedReason: null,
    updatedAt: new Date(),
  } as any;

  await db
    .insert(invoices)
    .values(values)
    .onConflictDoUpdate({
      target: invoices.id,
      set: values,
    });
}

async function main() {
  const config = parsePortalValidationSeedConfig();
  const safetyErrors = getPortalValidationSeedSafetyErrors(config);
  if (safetyErrors.length > 0) {
    throw new Error(`Portal validation seed refused to run:\n- ${safetyErrors.join("\n- ")}`);
  }

  console.warn("This seed writes to the connected database. In local dev this may be the shared DEV cloud DB.");
  console.warn(`[PortalSeed] Runtime database classification: ${config.databaseRuntime} (${config.databaseLabel})`);

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, config.organizationId)).limit(1);
  if (!org) {
    throw new Error(`Organization not found: ${config.organizationId}`);
  }

  const user = await ensureUser(config);
  await upsertProduct(config);

  await db
    .update(customers)
    .set({ userId: null, updatedAt: new Date() } as any)
    .where(and(eq(customers.userId, user.id), ne(customers.id, config.customerId)));

  const customerValues = {
    id: config.customerId,
    organizationId: config.organizationId,
    companyName: config.customerName,
    customerType: "business",
    email: config.email,
    phone: "555-0199",
    billingAddress: "123 Portal Validation Way\nDev City, NY 10001",
    shippingAddress: "123 Portal Validation Way\nDev City, NY 10001",
    productVisibilityMode: "default",
    isActive: true,
    status: "active",
    userId: user.id,
    notes: "DEV-only customer portal validation seed.",
    updatedAt: new Date(),
  } as any;

  await db
    .insert(customers)
    .values(customerValues)
    .onConflictDoUpdate({
      target: customers.id,
      set: customerValues,
    });

  const invoiceIds = Object.values(config.invoiceIds);
  const issueDate = daysFromNow(-1);

  await upsertInvoice({
    id: config.invoiceIds.payable,
    invoiceNumber: config.invoiceNumbers.payable,
    status: "sent",
    config,
    userId: user.id,
    issueDate,
    dueDate: daysFromNow(29),
  });
  await upsertInvoice({
    id: config.invoiceIds.paid,
    invoiceNumber: config.invoiceNumbers.paid,
    status: "sent",
    config,
    userId: user.id,
    issueDate,
    dueDate: daysFromNow(29),
  });
  await upsertInvoice({
    id: config.invoiceIds.draft,
    invoiceNumber: config.invoiceNumbers.draft,
    status: "draft",
    config,
    userId: user.id,
    issueDate,
    dueDate: null,
  });
  await upsertInvoice({
    id: config.invoiceIds.void,
    invoiceNumber: config.invoiceNumbers.void,
    status: "void",
    config,
    userId: user.id,
    issueDate,
    dueDate: daysFromNow(29),
  });
  await upsertInvoice({
    id: config.invoiceIds.stripeConfirmFirst,
    invoiceNumber: config.invoiceNumbers.stripeConfirmFirst,
    status: "sent",
    config,
    userId: user.id,
    issueDate,
    dueDate: daysFromNow(29),
  });
  await upsertInvoice({
    id: config.invoiceIds.stripeWebhookFirst,
    invoiceNumber: config.invoiceNumbers.stripeWebhookFirst,
    status: "sent",
    config,
    userId: user.id,
    issueDate,
    dueDate: daysFromNow(29),
  });
  await upsertInvoice({
    id: config.invoiceIds.stripeFailed,
    invoiceNumber: config.invoiceNumbers.stripeFailed,
    status: "sent",
    config,
    userId: user.id,
    issueDate,
    dueDate: daysFromNow(29),
  });

  await db.delete(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, invoiceIds));

  await db.insert(invoiceLineItems).values(
    invoiceIds.map((invoiceId, index) => ({
      id: `${invoiceId}-line-1`,
      invoiceId,
      productId: config.productId,
      productVariantId: null,
      productType: "validation",
      name: "Portal Validation Print",
      description: "Portal validation print package",
      width: "24.00",
      height: "36.00",
      quantity: 1,
      sqft: "6.00",
      unitPrice: money(config.invoiceAmountCents),
      totalPrice: money(config.invoiceAmountCents),
      unitPriceCents: config.invoiceAmountCents,
      lineTotalCents: config.invoiceAmountCents,
      sortOrder: index,
      specsJson: { portalValidationSeed: true },
      selectedOptions: [],
    } as any)),
  );

  await db.delete(payments).where(and(inArray(payments.invoiceId, invoiceIds), eq(payments.provider, "stripe")));

  await db.delete(payments).where(eq(payments.id, config.paymentIds.paid));
  await db.insert(payments).values({
    id: config.paymentIds.paid,
    organizationId: config.organizationId,
    invoiceId: config.invoiceIds.paid,
    provider: "manual",
    status: "succeeded",
    amount: money(config.invoiceAmountCents),
    amountCents: config.invoiceAmountCents,
    currency: "USD",
    method: "credit_card",
    notes: "DEV-only portal validation payment.",
    note: "DEV-only portal validation payment.",
    metadata: { portalValidationSeed: true },
    paidAt: daysFromNow(-1),
    succeededAt: daysFromNow(-1),
    appliedAt: daysFromNow(-1),
    createdByUserId: user.id,
    syncStatus: "skipped",
  } as any);

  await Promise.all(invoiceIds.map((invoiceId) => refreshInvoiceStatus(invoiceId)));

  console.log(
    JSON.stringify(
      {
        email: config.email,
        userId: user.id,
        customerId: config.customerId,
        organizationId: config.organizationId,
        invoices: {
          payable: { id: config.invoiceIds.payable, invoiceNumber: config.invoiceNumbers.payable },
          paid: { id: config.invoiceIds.paid, invoiceNumber: config.invoiceNumbers.paid },
          draft: { id: config.invoiceIds.draft, invoiceNumber: config.invoiceNumbers.draft },
          void: { id: config.invoiceIds.void, invoiceNumber: config.invoiceNumbers.void },
          stripeConfirmFirst: { id: config.invoiceIds.stripeConfirmFirst, invoiceNumber: config.invoiceNumbers.stripeConfirmFirst },
          stripeWebhookFirst: { id: config.invoiceIds.stripeWebhookFirst, invoiceNumber: config.invoiceNumbers.stripeWebhookFirst },
          stripeFailed: { id: config.invoiceIds.stripeFailed, invoiceNumber: config.invoiceNumbers.stripeFailed },
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
