import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { InboundOrdersRepository } from "../storage/inboundOrders.repo";
import {
  customerContacts,
  customers,
  inboundOrderLineItems,
  inboundOrderRecords,
  organizations,
  products,
} from "@shared/schema";

describe("Inbound Orders queue search and sorting", () => {
  const suffix = randomUUID().slice(0, 8);
  const organizationId = `inbound_search_${suffix}`;
  const repository = new InboundOrdersRepository();
  let t3RecordId = "";
  let alphaRecordId = "";

  beforeAll(async () => {
    await db.insert(organizations).values({
      id: organizationId,
      name: `Inbound Search ${suffix}`,
      slug: `inbound-search-${suffix}`,
    });

    const [t3Customer, alphaCustomer] = await db.insert(customers).values([
      { organizationId, companyName: "T3 Signs", email: "orders@t3signs.test" },
      { organizationId, companyName: "Alpha Graphics", email: "hello@alpha.test" },
    ]).returning();
    const [t3Contact] = await db.insert(customerContacts).values({
      organizationId,
      customerId: t3Customer.id,
      firstName: "Taylor",
      lastName: "Three",
      email: "buyer@t3signs.test",
    }).returning();
    const [acmProduct] = await db.insert(products).values({
      organizationId,
      name: "ACM Panels",
      description: "Aluminum composite signs",
    }).returning();

    const [t3Record, alphaRecord] = await db.insert(inboundOrderRecords).values([
      {
        organizationId,
        sourceType: "email",
        matchedCustomerId: t3Customer.id,
        matchedContactId: t3Contact.id,
        externalReference: "PO-T3-44",
        rawPayloadJson: {
          sender: { name: "Taylor Three", email: "buyer@t3signs.test" },
          subject: "Summer sticker reorder",
          bodyText: "Please produce the waterproof labels from our prior job.",
        },
        normalizedPayloadJson: {},
        extractedCustomerJson: { companyName: "T3 Signs" },
        extractedOrderJson: { poNumber: "PO-T3-44", dueDate: "2026-08-15" },
        receivedAt: new Date("2026-07-20T15:00:00Z"),
      },
      {
        organizationId,
        sourceType: "email",
        matchedCustomerId: alphaCustomer.id,
        rawPayloadJson: {
          sender: { name: "Alex Alpha", email: "alex@alpha.test" },
          subject: "Banner request",
          bodyText: "Need two outdoor banners.",
        },
        normalizedPayloadJson: {},
        extractedCustomerJson: { companyName: "Alpha Graphics" },
        extractedOrderJson: { dueDate: "2026-08-01" },
        receivedAt: new Date("2026-07-19T15:00:00Z"),
      },
    ]).returning();
    t3RecordId = t3Record.id;
    alphaRecordId = alphaRecord.id;

    await db.insert(inboundOrderLineItems).values({
      organizationId,
      inboundRecordId: t3Record.id,
      productId: acmProduct.id,
      productNameRaw: "3mm ACM sign",
      description: "Printed ACM panel",
      rawLineJson: { sourceText: "ACM signs" },
      normalizedLineJson: { productName: "ACM Panels" },
    });
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  });

  async function search(value: string) {
    return repository.listRecords(organizationId, {
      statusGroup: "active",
      search: value,
      sort: "received_desc",
      limit: 50,
      offset: 0,
    });
  }

  test.each([
    ["customer name", "t3", () => t3RecordId],
    ["sender email", "buyer@t3signs", () => t3RecordId],
    ["subject", "summer sticker", () => t3RecordId],
    ["parsed product", "acm", () => t3RecordId],
    ["email body", "waterproof labels", () => t3RecordId],
    ["PO reference", "po-t3-44", () => t3RecordId],
  ])("searches by %s", async (_label, query, expectedId) => {
    const rows = await search(query);
    expect(rows.map((row) => row.id)).toEqual([expectedId()]);
  });

  test("sorts customer names A-Z and Z-A", async () => {
    const ascending = await repository.listRecords(organizationId, {
      statusGroup: "active",
      sort: "customer_asc",
      limit: 50,
      offset: 0,
    });
    const descending = await repository.listRecords(organizationId, {
      statusGroup: "active",
      sort: "customer_desc",
      limit: 50,
      offset: 0,
    });

    expect(ascending.map((row) => row.id)).toEqual([alphaRecordId, t3RecordId]);
    expect(descending.map((row) => row.id)).toEqual([t3RecordId, alphaRecordId]);
  });
});
