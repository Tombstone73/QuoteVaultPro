import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { runMigrations } from "../runMigrations";
import { createInvoiceFromOrder } from "../invoicesService";
import {
  auditLogs,
  customerContactLinks,
  customerContacts,
  customerPortalAccess,
  customers,
  invoiceLineItems,
  invoices,
  orderLineItems,
  orders,
  organizations,
  products,
  users,
} from "../../shared/schema";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

const cleanupOrgIds: string[] = [];
const cleanupUserIds: string[] = [];

async function createBaseFixture(label: string) {
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const [org] = await db.insert(organizations).values({
    name: `Contact Billing ${suffix}`,
    slug: `contact-billing-${suffix}`.slice(0, 95),
  }).returning();
  cleanupOrgIds.push(org.id);

  const [user] = await db.insert(users).values({
    email: `contact-billing-${suffix}@example.test`,
    firstName: "Contact",
    lastName: "Billing",
    role: "admin",
  }).returning();
  cleanupUserIds.push(user.id);

  const [product] = await db.insert(products).values({
    organizationId: org.id,
    name: `Billing Product ${suffix}`,
    description: "Contact accounting promotion test product",
    pricingMode: "flat",
    pricingProfileKey: "default",
  } as any).returning();

  return { org, user, product, suffix };
}

async function createStandaloneContactOrder(label: string, overrides: Partial<typeof customerContacts.$inferInsert> = {}) {
  const fixture = await createBaseFixture(label);
  const [contact] = await db.insert(customerContacts).values({
    organizationId: fixture.org.id,
    firstName: "Jane",
    lastName: "Standalone",
    email: `jane-${fixture.suffix}@example.test`,
    phone: "555-0100",
    street1: "100 Main St",
    city: "Tombstone",
    state: "AZ",
    postalCode: "85638",
    status: "active",
    ...overrides,
  } as any).returning();

  const [order] = await db.insert(orders).values({
    organizationId: fixture.org.id,
    orderNumber: `CB-${fixture.suffix}`.slice(0, 50),
    customerId: null,
    contactId: contact.id,
    status: "ready_for_fulfillment",
    state: "production_complete",
    subtotal: "42.00",
    total: "42.00",
    createdByUserId: fixture.user.id,
  } as any).returning();

  await db.insert(orderLineItems).values({
    orderId: order.id,
    productId: fixture.product.id,
    productType: "wide_roll",
    description: "Contact-only billable item",
    quantity: 1,
    unitPrice: "42.00",
    totalPrice: "42.00",
    sortOrder: 0,
    status: "complete",
    workflowState: "complete",
  } as any);

  return { ...fixture, contact, order };
}

afterEach(async () => {
  if (cleanupOrgIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.organizationId, cleanupOrgIds));
    await db.delete(customerPortalAccess).where(inArray(customerPortalAccess.organizationId, cleanupOrgIds));
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
    await db.delete(customerContactLinks).where(inArray(customerContactLinks.organizationId, cleanupOrgIds));
    await db.delete(customerContacts).where(inArray(customerContacts.organizationId, cleanupOrgIds));
    await db.delete(customers).where(inArray(customers.organizationId, cleanupOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, cleanupOrgIds));
    cleanupOrgIds.length = 0;
  }

  if (cleanupUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, cleanupUserIds));
    cleanupUserIds.length = 0;
  }
});

describe("contact accounting promotion", () => {
  test("contact-only order creates an individual customer during invoice creation", async () => {
    const { org, user, contact, order } = await createStandaloneContactOrder("create-individual");

    const invoice = await createInvoiceFromOrder(org.id, order.id, user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    });

    const [updatedOrder] = await db.select().from(orders).where(and(eq(orders.organizationId, org.id), eq(orders.id, order.id)));
    expect(updatedOrder.customerId).toBeTruthy();
    expect(updatedOrder.contactId).toBe(contact.id);
    expect(invoice.customerId).toBe(updatedOrder.customerId);
    expect(invoice.accountingPromotion?.resolution).toBe("created_individual_customer");

    const [customer] = await db.select().from(customers).where(eq(customers.id, updatedOrder.customerId!));
    expect(customer.customerType).toBe("individual");
    expect(customer.companyName).toBe("Jane Standalone");
    expect(customer.displayName).toBe("Jane Standalone");
    expect(customer.individualFirstName).toBe("Jane");
    expect(customer.individualLastName).toBe("Standalone");
    expect(customer.sourceContactId).toBe(contact.id);
    expect(customer.accountCreationSource).toBe("accounting_promotion");

    const [link] = await db.select().from(customerContactLinks).where(and(eq(customerContactLinks.customerId, customer.id), eq(customerContactLinks.contactId, contact.id)));
    expect(link.status).toBe("active");
    expect(link.isPrimary).toBe(true);
    expect(link.isBilling).toBe(true);

    const portalRows = await db.select().from(customerPortalAccess).where(eq(customerPortalAccess.customerId, customer.id));
    expect(portalRows).toHaveLength(0);

    const auditRows = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, org.id), eq(auditLogs.actionType, "order_contact_accounting_promotion")));
    expect(auditRows).toHaveLength(1);
    expect((auditRows[0].newValues as any).sourceContactId).toBe(contact.id);
    expect((auditRows[0].newValues as any).invoiceId).toBe(invoice.id);
  });

  test("future orders reuse the existing individual customer by source contact", async () => {
    const first = await createStandaloneContactOrder("reuse-source");
    const firstInvoice = await createInvoiceFromOrder(first.org.id, first.order.id, first.user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    });

    const [secondOrder] = await db.insert(orders).values({
      organizationId: first.org.id,
      orderNumber: `CB-SECOND-${Date.now()}`.slice(0, 50),
      customerId: null,
      contactId: first.contact.id,
      status: "ready_for_fulfillment",
      state: "production_complete",
      subtotal: "42.00",
      total: "42.00",
      createdByUserId: first.user.id,
    } as any).returning();
    await db.insert(orderLineItems).values({
      orderId: secondOrder.id,
      productId: first.product.id,
      productType: "wide_roll",
      description: "Second contact-only billable item",
      quantity: 1,
      unitPrice: "42.00",
      totalPrice: "42.00",
      sortOrder: 0,
      status: "complete",
      workflowState: "complete",
    } as any);

    const secondInvoice = await createInvoiceFromOrder(first.org.id, secondOrder.id, first.user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    });

    expect(secondInvoice.customerId).toBe(firstInvoice.customerId);
    expect(secondInvoice.accountingPromotion?.resolution).toBe("linked_customer");

    const customerRows = await db.select().from(customers).where(and(eq(customers.organizationId, first.org.id), eq(customers.customerType, "individual")));
    expect(customerRows).toHaveLength(1);
  });

  test("contact linked to a business customer uses that business customer", async () => {
    const fixture = await createStandaloneContactOrder("business-link");
    const [business] = await db.insert(customers).values({
      organizationId: fixture.org.id,
      companyName: "Acme Signs",
      customerType: "business",
      email: "billing@acme.example.test",
    } as any).returning();
    await db.insert(customerContactLinks).values({
      organizationId: fixture.org.id,
      customerId: business.id,
      contactId: fixture.contact.id,
      status: "active",
      isPrimary: true,
      isBilling: true,
    } as any);
    await db.update(customerContacts).set({ customerId: business.id, updatedAt: new Date() }).where(eq(customerContacts.id, fixture.contact.id));

    const invoice = await createInvoiceFromOrder(fixture.org.id, fixture.order.id, fixture.user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    });

    expect(invoice.customerId).toBe(business.id);
    const individuals = await db.select().from(customers).where(and(eq(customers.organizationId, fixture.org.id), eq(customers.customerType, "individual")));
    expect(individuals).toHaveLength(0);
  });

  test("orders with neither customer nor contact fail safely", async () => {
    const fixture = await createBaseFixture("neither");
    const [order] = await db.insert(orders).values({
      organizationId: fixture.org.id,
      orderNumber: `CB-NEITHER-${Date.now()}`.slice(0, 50),
      customerId: null,
      contactId: null,
      status: "ready_for_fulfillment",
      state: "production_complete",
      subtotal: "42.00",
      total: "42.00",
      createdByUserId: fixture.user.id,
    } as any).returning();

    await expect(createInvoiceFromOrder(fixture.org.id, order.id, fixture.user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    })).rejects.toMatchObject({ code: "ORDER_CUSTOMER_REQUIRED_FOR_INVOICE" });
  });

  test("ambiguous individual email match blocks instead of guessing", async () => {
    const fixture = await createStandaloneContactOrder("ambiguous-email", { email: "shared@example.test" });
    await db.insert(customers).values([
      {
        organizationId: fixture.org.id,
        companyName: "Shared One",
        customerType: "individual",
        displayName: "Shared One",
        email: "shared@example.test",
      },
      {
        organizationId: fixture.org.id,
        companyName: "Shared Two",
        customerType: "individual",
        displayName: "Shared Two",
        email: "shared@example.test",
      },
    ] as any);

    await expect(createInvoiceFromOrder(fixture.org.id, fixture.order.id, fixture.user.id, {
      terms: "due_on_receipt",
      customDueDate: null,
    })).rejects.toMatchObject({ code: "CONTACT_BILLING_CUSTOMER_REVIEW_REQUIRED" });
  });

  test("concurrent promotions for the same standalone contact create one individual customer", async () => {
    const fixture = await createStandaloneContactOrder("concurrent");
    const [secondOrder] = await db.insert(orders).values({
      organizationId: fixture.org.id,
      orderNumber: `CB-CONCURRENT-${Date.now()}`.slice(0, 50),
      customerId: null,
      contactId: fixture.contact.id,
      status: "ready_for_fulfillment",
      state: "production_complete",
      subtotal: "42.00",
      total: "42.00",
      createdByUserId: fixture.user.id,
    } as any).returning();
    await db.insert(orderLineItems).values({
      orderId: secondOrder.id,
      productId: fixture.product.id,
      productType: "wide_roll",
      description: "Concurrent contact-only billable item",
      quantity: 1,
      unitPrice: "42.00",
      totalPrice: "42.00",
      sortOrder: 0,
      status: "complete",
      workflowState: "complete",
    } as any);

    const [firstInvoice, secondInvoice] = await Promise.all([
      createInvoiceFromOrder(fixture.org.id, fixture.order.id, fixture.user.id, { terms: "due_on_receipt", customDueDate: null }),
      createInvoiceFromOrder(fixture.org.id, secondOrder.id, fixture.user.id, { terms: "due_on_receipt", customDueDate: null }),
    ]);

    expect(firstInvoice.customerId).toBe(secondInvoice.customerId);
    const customerRows = await db.select().from(customers).where(and(eq(customers.organizationId, fixture.org.id), eq(customers.customerType, "individual")));
    expect(customerRows).toHaveLength(1);
  });
});
