import { beforeAll, afterAll, describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tenantContext } from "../tenantContext";
import { registerCustomerRelationsRoutes, contactLinkRequiresMoveConfirmation } from "../routes/customerRelations.routes";
import {
  createCustomerContactForOrganization,
  getContactWithRelations,
  getCustomerContacts,
} from "../storage";

const suffix = `${Date.now()}_${Math.floor(Math.random() * 99999)}`;
const ORG_ID = `org_contact_link_${suffix}`;
const USER_ID = `user_contact_link_${suffix}`;
const CREATE_CUSTOMER = `cust_link_create_${suffix}`;
const SOURCE_CUSTOMER = `cust_link_source_${suffix}`;
const TARGET_CUSTOMER = `cust_link_target_${suffix}`;
const PRIMARY_CUSTOMER = `cust_link_primary_${suffix}`;
const REPAIR_SOURCE_CUSTOMER = `cust_link_repair_source_${suffix}`;
const REPAIR_TARGET_CUSTOMER = `cust_link_repair_target_${suffix}`;

const TEST_CUSTOMERS = [
  { id: CREATE_CUSTOMER, companyName: "Create Flow Customer" },
  { id: SOURCE_CUSTOMER, companyName: "Source Customer" },
  { id: TARGET_CUSTOMER, companyName: "Target Customer" },
  { id: PRIMARY_CUSTOMER, companyName: "Primary Customer" },
  { id: REPAIR_SOURCE_CUSTOMER, companyName: "Repair Source Customer" },
  { id: REPAIR_TARGET_CUSTOMER, companyName: "Repair Target Customer" },
];

const authHeaders = {
  "x-test-user-id": USER_ID,
  "x-test-org-id": ORG_ID,
};

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res: Response, next: NextFunction) => {
    const userId = req.headers["x-test-user-id"];
    const orgId = req.headers["x-test-org-id"];
    if (orgId) req.headers["x-organization-id"] = orgId;
    if (userId) {
      req.user = { id: String(userId), role: "admin" };
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
    next();
  });

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (req.isAuthenticated?.()) return next();
    return res.status(401).json({ success: false, message: "Unauthorized" });
  };

  const isAdmin = (_req: any, _res: Response, next: NextFunction) => next();

  registerCustomerRelationsRoutes(app, { isAuthenticated, tenantContext, isAdmin });
  return app;
}

async function createContact(
  customerId: string,
  fields: {
    firstName: string;
    lastName: string;
    email?: string;
    isPrimary?: boolean;
  },
) {
  return createCustomerContactForOrganization(ORG_ID, customerId, {
    firstName: fields.firstName,
    lastName: fields.lastName,
    email: fields.email ?? `${fields.firstName}.${fields.lastName}.${suffix}@example.com`.toLowerCase(),
    isPrimary: fields.isPrimary ?? false,
  });
}

beforeAll(async () => {
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values (${ORG_ID}, ${"Contact Link Test Org"}, ${`contact-link-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into users (id, email, role, is_admin, is_platform_admin)
    values (${USER_ID}, ${`contact-link-${suffix}@test.com`}, ${"admin"}, ${false}, ${false})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into user_organizations (user_id, organization_id, role, is_default)
    values (${USER_ID}, ${ORG_ID}, ${"admin"}, ${true})
    on conflict (user_id, organization_id) do nothing
  `);

  for (const customer of TEST_CUSTOMERS) {
    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit)
      values (${customer.id}, ${ORG_ID}, ${customer.companyName}, ${"active"}, ${"business"}, ${"0"}, ${"0"})
      on conflict (id) do nothing
    `);
  }
});

afterAll(async () => {
  for (const customer of TEST_CUSTOMERS) {
    await db.execute(sql`delete from customer_contacts where customer_id = ${customer.id}`);
  }
  for (const customer of TEST_CUSTOMERS) {
    await db.execute(sql`delete from customers where id = ${customer.id}`);
  }
  await db.execute(sql`delete from user_organizations where user_id = ${USER_ID}`);
  await db.execute(sql`delete from users where id = ${USER_ID}`);
  await db.execute(sql`delete from organizations where id = ${ORG_ID}`);
});

const app = createTestApp();

describe("customer detail contact linking", () => {
  test("creates a contact from customer detail linked to the current customer", async () => {
    const res = await request(app)
      .post(`/api/customers/${CREATE_CUSTOMER}/contacts`)
      .set(authHeaders)
      .send({
        firstName: "Created",
        lastName: "Linked",
        email: `created.linked.${suffix}@example.com`,
      })
      .expect(200);

    expect(res.body.customerId).toBe(CREATE_CUSTOMER);
    expect(res.body.firstName).toBe("Created");
    expect(res.body.lastName).toBe("Linked");
  });

  test("does not require move confirmation for an unlinked contact state", () => {
    expect(contactLinkRequiresMoveConfirmation(null, TARGET_CUSTOMER)).toBe(false);
    expect(contactLinkRequiresMoveConfirmation(undefined, TARGET_CUSTOMER)).toBe(false);
  });

  test("requires confirmation before moving a contact from another customer", async () => {
    const contact = await createContact(SOURCE_CUSTOMER, {
      firstName: "Move",
      lastName: "Guarded",
    });

    const res = await request(app)
      .post(`/api/customers/${TARGET_CUSTOMER}/contacts/${contact.id}/link`)
      .set(authHeaders)
      .send({ setPrimary: false })
      .expect(409);

    expect(res.body.message).toContain("requires confirmation");
    expect(res.body.requiresMoveConfirmation).toBe(true);
    expect(res.body.fromCustomer).toEqual({ id: SOURCE_CUSTOMER, companyName: "Source Customer" });
    expect(res.body.toCustomer).toEqual({ id: TARGET_CUSTOMER, companyName: "Target Customer" });

    const unchanged = await getContactWithRelations(contact.id, ORG_ID);
    expect(unchanged?.customerId).toBe(SOURCE_CUSTOMER);
  });

  test("links a confirmed existing contact and returns source and target context", async () => {
    const contact = await createContact(SOURCE_CUSTOMER, {
      firstName: "Move",
      lastName: "Confirmed",
    });

    const res = await request(app)
      .post(`/api/customers/${TARGET_CUSTOMER}/contacts/${contact.id}/link`)
      .set(authHeaders)
      .send({ setPrimary: false, confirmMove: true })
      .expect(200);

    expect(res.body.contact.customerId).toBe(TARGET_CUSTOMER);
    expect(res.body.moved).toBe(true);
    expect(res.body.requiresMoveConfirmation).toBe(true);
    expect(res.body.fromCustomer).toEqual({ id: SOURCE_CUSTOMER, companyName: "Source Customer" });
    expect(res.body.toCustomer).toEqual({ id: TARGET_CUSTOMER, companyName: "Target Customer" });
  });

  test("setting a primary contact clears the prior primary for the same customer", async () => {
    const firstPrimary = await createContact(PRIMARY_CUSTOMER, {
      firstName: "Primary",
      lastName: "First",
      isPrimary: true,
    });
    const secondContact = await createContact(PRIMARY_CUSTOMER, {
      firstName: "Primary",
      lastName: "Second",
      isPrimary: false,
    });

    await request(app)
      .post(`/api/customer-contacts/${secondContact.id}/set-primary`)
      .set(authHeaders)
      .expect(200);

    const contacts = await getCustomerContacts(PRIMARY_CUSTOMER);
    const primaryContacts = contacts.filter((contact) => contact.isPrimary);

    expect(primaryContacts).toHaveLength(1);
    expect(primaryContacts[0]?.id).toBe(secondContact.id);

    const demoted = contacts.find((contact) => contact.id === firstPrimary.id);
    expect(demoted?.isPrimary).toBe(false);
  });

  test("moving a primary contact away repairs the old customer's primary contact", async () => {
    const fallback = await createContact(REPAIR_SOURCE_CUSTOMER, {
      firstName: "Repair",
      lastName: "Fallback",
      isPrimary: false,
    });
    const primaryToMove = await createContact(REPAIR_SOURCE_CUSTOMER, {
      firstName: "Repair",
      lastName: "Moved",
      isPrimary: true,
    });

    await request(app)
      .post(`/api/customers/${REPAIR_TARGET_CUSTOMER}/contacts/${primaryToMove.id}/link`)
      .set(authHeaders)
      .send({ setPrimary: false, confirmMove: true })
      .expect(200);

    const oldCustomerContacts = await getCustomerContacts(REPAIR_SOURCE_CUSTOMER);
    const oldCustomerPrimaries = oldCustomerContacts.filter((contact) => contact.isPrimary);
    const movedContact = await getContactWithRelations(primaryToMove.id, ORG_ID);

    expect(oldCustomerPrimaries).toHaveLength(1);
    expect(oldCustomerPrimaries[0]?.id).toBe(fallback.id);
    expect(movedContact?.customerId).toBe(REPAIR_TARGET_CUSTOMER);
    expect(movedContact?.isPrimary).toBe(false);
  });
});
