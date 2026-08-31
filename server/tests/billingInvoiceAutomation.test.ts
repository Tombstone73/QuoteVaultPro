import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { runMigrations } from "../runMigrations";
import {
  auditLogs,
  customers,
  invoiceLineItems,
  invoices,
  orderLineItems,
  orders,
  organizations,
  products,
  users,
} from "../../shared/schema";
import { billingInvoiceAutomationService } from "../services/billingInvoiceAutomation";
import { computeOperationalSummary } from "../services/operationalSummary";
import { createInvoiceFromOrder } from "../invoicesService";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

const TS = Date.now();
const cleanupOrgIds: string[] = [];
const cleanupUserIds: string[] = [];

async function createFixture(policy: string) {
  const suffix = `${policy}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const [org] = await db.insert(organizations).values({
    name: `Billing Automation ${suffix}`,
    slug: `billing-auto-${suffix}`.slice(0, 95),
    settings: {
      preferences: {
        billingInvoiceTriggerPolicy: policy,
      },
    } as any,
  }).returning();
  cleanupOrgIds.push(org.id);

  const [user] = await db.insert(users).values({
    email: `billing-auto-${suffix}-${TS}@example.test`,
    firstName: "Billing",
    lastName: "Automation",
    role: "admin",
  }).returning();
  cleanupUserIds.push(user.id);

  const [customer] = await db.insert(customers).values({
    organizationId: org.id,
    companyName: `Billing Customer ${suffix}`,
    email: `customer-${suffix}@example.test`,
  }).returning();

  const [product] = await db.insert(products).values({
    organizationId: org.id,
    name: `Billing Product ${suffix}`,
    description: "Invoice automation test product",
    pricingMode: "flat",
    pricingProfileKey: "default",
  } as any).returning();

  const [order] = await db.insert(orders).values({
    organizationId: org.id,
    orderNumber: `BA-${suffix}`.slice(0, 50),
    customerId: customer.id,
    status: "ready_for_fulfillment",
    state: "production_complete",
    routingTarget: "fulfillment",
    fulfillmentStatus: "packed",
    shippingMethod: "pickup",
    subtotal: "123.45",
    total: "123.45",
    createdByUserId: user.id,
  } as any).returning();

  await db.insert(orderLineItems).values({
    orderId: order.id,
    productId: product.id,
    productType: "wide_roll",
    description: "Automation line item",
    quantity: 3,
    unitPrice: "41.15",
    totalPrice: "123.45",
    sortOrder: 0,
    status: "complete",
    workflowState: "complete",
  } as any);

  return { org, user, customer, product, order };
}

afterEach(async () => {
  if (cleanupOrgIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.organizationId, cleanupOrgIds));
    await db.delete(invoiceLineItems).where(
      inArray(
        invoiceLineItems.invoiceId,
        db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.organizationId, cleanupOrgIds)),
      ),
    );
    await db.delete(invoices).where(inArray(invoices.organizationId, cleanupOrgIds));
    await db.delete(orderLineItems).where(
      inArray(
        orderLineItems.orderId,
        db.select({ id: orders.id }).from(orders).where(inArray(orders.organizationId, cleanupOrgIds)),
      ),
    );
    await db.delete(orders).where(inArray(orders.organizationId, cleanupOrgIds));
    await db.delete(products).where(inArray(products.organizationId, cleanupOrgIds));
    await db.delete(customers).where(inArray(customers.organizationId, cleanupOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, cleanupOrgIds));
    cleanupOrgIds.length = 0;
  }

  if (cleanupUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, cleanupUserIds));
    cleanupUserIds.length = 0;
  }
});

describe("billing invoice automation", () => {
  test("manual_only policy does not auto-create an invoice", async () => {
    const { org, user, order } = await createFixture("manual_only");

    const result = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });

    expect(result.status).toBe("skipped_policy_mismatch");

    const rows = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(rows).toHaveLength(0);
  });

  test("ready_for_pickup policy creates one draft invoice and no duplicate on repeat", async () => {
    const { org, user, order } = await createFixture("ready_for_pickup_or_ready_to_ship");

    const first = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });

    expect(first.status).toBe("created");
    expect(first.invoice?.status).toBe("draft");

    const second = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });

    expect(second.status).toBe("skipped_existing_invoice");
    expect(second.invoice?.id).toBe(first.invoice?.id);

    const invoiceRows = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(invoiceRows).toHaveLength(1);
    expect(invoiceRows[0].status).toBe("draft");
    expect(invoiceRows[0].invoiceCreationSource).toBe("automation");
    expect(invoiceRows[0].billingMilestone).toBe("ready_for_pickup_or_ready_to_ship");
    expect(invoiceRows[0].lastSentAt).toBeNull();
    expect(invoiceRows[0].amountPaid).toBe("0.00");
    expect(invoiceRows[0].totalCents).toBe(12345);

    const lineRows = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceRows[0].id));
    expect(lineRows).toHaveLength(1);
    expect(lineRows[0].lineTotalCents).toBe(12345);

    const summary = await computeOperationalSummary(org.id);
    expect(summary.invoices.pendingSend).toBe(1);
  });

  test("existing sent invoice prevents duplicate creation", async () => {
    const { org, user, order } = await createFixture("ready_for_pickup_or_ready_to_ship");

    const first = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });
    expect(first.status).toBe("created");

    await db
      .update(invoices)
      .set({ status: "sent", updatedAt: new Date() } as any)
      .where(and(eq(invoices.organizationId, org.id), eq(invoices.id, first.invoice!.id)));

    const second = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });

    expect(second.status).toBe("skipped_existing_invoice");
    expect(second.invoice?.status).toBe("sent");

    const invoiceRows = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(invoiceRows).toHaveLength(1);
  });

  test("an existing invoice rejects a duplicate manual creation", async () => {
    const { org, user, order } = await createFixture("ready_for_pickup_or_ready_to_ship");

    const automated = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });
    expect(automated.status).toBe("created");

    await expect(createInvoiceFromOrder(org.id, order.id, user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    })).rejects.toMatchObject({ code: "INVOICE_ALREADY_EXISTS" });

    const invoiceRows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.orderId, order.id));

    const later = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY_RETRY",
      actorUserId: user.id,
    });
    expect(later.status).toBe("skipped_existing_invoice");
    expect(invoiceRows).toHaveLength(1);
    expect(later.invoice?.id).toBe(automated.invoice?.id);
  });

  test("manual invoice created first blocks an automated milestone invoice", async () => {
    const { org, user, order } = await createFixture("ready_for_pickup_or_ready_to_ship");

    const manual = await createInvoiceFromOrder(org.id, order.id, user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    });
    expect(manual.invoiceCreationSource).toBe("manual");

    const automated = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });

    expect(automated.status).toBe("skipped_existing_invoice");

    const invoiceRows = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(invoiceRows).toHaveLength(1);
    expect(automated.invoice?.id).toBe(manual.id);
  });

  test("database unique index prevents duplicate automated milestone invoices", async () => {
    const { org, user, customer, order } = await createFixture("ready_for_pickup_or_ready_to_ship");

    const first = await billingInvoiceAutomationService.ensureOrderBackedInvoiceForOrderTrigger({
      organizationId: org.id,
      orderId: order.id,
      trigger: "ready_for_pickup_or_ready_to_ship",
      sourceEvent: "PICKUP_READY",
      actorUserId: user.id,
    });
    expect(first.status).toBe("created");

    await expect(db.insert(invoices).values({
      organizationId: org.id,
      invoiceNumber: Math.floor(Math.random() * 900000) + 100000,
      orderId: order.id,
      customerId: customer.id,
      status: "draft",
      terms: "due_on_receipt",
      subtotal: "0.00",
      tax: "0.00",
      total: "0.00",
      subtotalCents: 0,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 0,
      amountPaid: "0.00",
      balanceDue: "0.00",
      createdByUserId: user.id,
      invoiceCreationSource: "automation",
      billingMilestone: "ready_for_pickup_or_ready_to_ship",
    } as any)).rejects.toMatchObject({
      code: "23505",
    });
  });
});
