import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tenantContext } from "../tenantContext";
import { registerCustomerRelationsRoutes } from "../routes/customerRelations.routes";

const suffix = `${Date.now()}_${Math.floor(Math.random() * 99999)}`;
const ORG_A_ID = `org_customer_rel_a_${suffix}`;
const ORG_B_ID = `org_customer_rel_b_${suffix}`;
const USER_ID = `user_customer_rel_${suffix}`;
const ORG_A_CUSTOMER_ID = `cust_rel_a_${suffix}`;
const ORG_B_CUSTOMER_ID = `cust_rel_b_${suffix}`;
const ORG_A_NOTE_ID = `note_rel_a_${suffix}`;
const ORG_B_NOTE_ID = `note_rel_b_${suffix}`;
const ORG_A_DELETE_NOTE_ID = `note_rel_a_delete_${suffix}`;
const ORG_B_DELETE_NOTE_ID = `note_rel_b_delete_${suffix}`;
const ORG_A_CREDIT_ID = `credit_rel_a_${suffix}`;
const ORG_B_CREDIT_ID = `credit_rel_b_${suffix}`;

const orgAHeaders = {
  "x-test-user-id": USER_ID,
  "x-test-org-id": ORG_A_ID,
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

  // The vulnerable route already preserves this admin gate; tenant scoping must still deny Org B rows.
  const isAdmin = (_req: any, _res: Response, next: NextFunction) => next();

  registerCustomerRelationsRoutes(app, { isAuthenticated, tenantContext, isAdmin });
  return app;
}

async function getNoteCount(noteId: string) {
  const result = await db.execute(sql`select count(*)::int as count from customer_notes where id = ${noteId}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function getCreditTransactionDescription(transactionId: string) {
  const result = await db.execute(sql`
    select description
    from customer_credit_transactions
    where id = ${transactionId}
  `);
  return result.rows[0]?.description as string | undefined;
}

beforeAll(async () => {
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values
      (${ORG_A_ID}, ${"Customer Relations Org A"}, ${`customer-rel-a-${suffix}`}),
      (${ORG_B_ID}, ${"Customer Relations Org B"}, ${`customer-rel-b-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into users (id, email, role, is_admin, is_platform_admin)
    values (${USER_ID}, ${`customer-rel-${suffix}@test.com`}, ${"admin"}, ${true}, ${false})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into user_organizations (user_id, organization_id, role, is_default)
    values (${USER_ID}, ${ORG_A_ID}, ${"admin"}, ${true})
    on conflict (user_id, organization_id) do nothing
  `);

  await db.execute(sql`
    insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit)
    values
      (${ORG_A_CUSTOMER_ID}, ${ORG_A_ID}, ${"Org A Customer"}, ${"active"}, ${"business"}, ${"0"}, ${"0"}),
      (${ORG_B_CUSTOMER_ID}, ${ORG_B_ID}, ${"Org B Customer"}, ${"active"}, ${"business"}, ${"0"}, ${"0"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into customer_notes (id, customer_id, user_id, note, is_internal)
    values
      (${ORG_A_NOTE_ID}, ${ORG_A_CUSTOMER_ID}, ${USER_ID}, ${"Org A note"}, ${true}),
      (${ORG_B_NOTE_ID}, ${ORG_B_CUSTOMER_ID}, ${USER_ID}, ${"Org B note"}, ${true}),
      (${ORG_A_DELETE_NOTE_ID}, ${ORG_A_CUSTOMER_ID}, ${USER_ID}, ${"Org A delete note"}, ${true}),
      (${ORG_B_DELETE_NOTE_ID}, ${ORG_B_CUSTOMER_ID}, ${USER_ID}, ${"Org B delete note"}, ${true})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into customer_credit_transactions (id, customer_id, user_id, transaction_type, amount, description)
    values
      (${ORG_A_CREDIT_ID}, ${ORG_A_CUSTOMER_ID}, ${USER_ID}, ${"payment"}, ${"10.00"}, ${"Org A credit"}),
      (${ORG_B_CREDIT_ID}, ${ORG_B_CUSTOMER_ID}, ${USER_ID}, ${"payment"}, ${"20.00"}, ${"Org B credit"})
    on conflict (id) do nothing
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from customer_credit_transactions where customer_id in (${ORG_A_CUSTOMER_ID}, ${ORG_B_CUSTOMER_ID})`);
  await db.execute(sql`delete from customer_notes where customer_id in (${ORG_A_CUSTOMER_ID}, ${ORG_B_CUSTOMER_ID})`);
  await db.execute(sql`delete from customers where id in (${ORG_A_CUSTOMER_ID}, ${ORG_B_CUSTOMER_ID})`);
  await db.execute(sql`delete from user_organizations where user_id = ${USER_ID}`);
  await db.execute(sql`delete from users where id = ${USER_ID}`);
  await db.execute(sql`delete from organizations where id in (${ORG_A_ID}, ${ORG_B_ID})`);
});

const app = createTestApp();

describe("customer notes and credit transaction tenant isolation", () => {
  test("Org A cannot read Org B customer notes by known customerId", async () => {
    await request(app)
      .get(`/api/customers/${ORG_B_CUSTOMER_ID}/notes`)
      .set(orgAHeaders)
      .expect(404);
  });

  test("Org A cannot create a note on Org B customer", async () => {
    await request(app)
      .post(`/api/customers/${ORG_B_CUSTOMER_ID}/notes`)
      .set(orgAHeaders)
      .send({ note: "Cross-org note attempt", isInternal: true })
      .expect(404);
  });

  test("Org A cannot patch or delete Org B note by known noteId", async () => {
    await request(app)
      .patch(`/api/customer-notes/${ORG_B_NOTE_ID}`)
      .set(orgAHeaders)
      .send({ note: "Cross-org note patch attempt" })
      .expect(404);

    await request(app)
      .delete(`/api/customer-notes/${ORG_B_DELETE_NOTE_ID}`)
      .set(orgAHeaders)
      .expect(404);

    expect(await getNoteCount(ORG_B_DELETE_NOTE_ID)).toBe(1);
  });

  test("Org A cannot read Org B credit transactions by known customerId", async () => {
    await request(app)
      .get(`/api/customers/${ORG_B_CUSTOMER_ID}/credit-transactions`)
      .set(orgAHeaders)
      .expect(404);
  });

  test("Org A cannot create a credit transaction on Org B customer", async () => {
    await request(app)
      .post(`/api/customers/${ORG_B_CUSTOMER_ID}/credit-transactions`)
      .set(orgAHeaders)
      .send({ transactionType: "payment", amount: "30.00", description: "Cross-org credit attempt" })
      .expect(404);
  });

  test("Org A global admin cannot patch Org B credit transaction by known transactionId", async () => {
    await request(app)
      .patch(`/api/customer-credit-transactions/${ORG_B_CREDIT_ID}`)
      .set(orgAHeaders)
      .send({ description: "Cross-org credit patch attempt" })
      .expect(404);

    expect(await getCreditTransactionDescription(ORG_B_CREDIT_ID)).toBe("Org B credit");
  });

  test("valid same-org note requests still work", async () => {
    const readRes = await request(app)
      .get(`/api/customers/${ORG_A_CUSTOMER_ID}/notes`)
      .set(orgAHeaders)
      .expect(200);
    expect(readRes.body.some((note: any) => note.id === ORG_A_NOTE_ID)).toBe(true);

    const createRes = await request(app)
      .post(`/api/customers/${ORG_A_CUSTOMER_ID}/notes`)
      .set(orgAHeaders)
      .send({ note: "Same-org note", isInternal: true })
      .expect(200);
    expect(createRes.body.customerId).toBe(ORG_A_CUSTOMER_ID);

    const patchRes = await request(app)
      .patch(`/api/customer-notes/${ORG_A_NOTE_ID}`)
      .set(orgAHeaders)
      .send({ note: "Same-org patched note" })
      .expect(200);
    expect(patchRes.body.note).toBe("Same-org patched note");

    await request(app)
      .delete(`/api/customer-notes/${ORG_A_DELETE_NOTE_ID}`)
      .set(orgAHeaders)
      .expect(200);
    expect(await getNoteCount(ORG_A_DELETE_NOTE_ID)).toBe(0);
  });

  test("valid same-org credit transaction requests still work", async () => {
    const readRes = await request(app)
      .get(`/api/customers/${ORG_A_CUSTOMER_ID}/credit-transactions`)
      .set(orgAHeaders)
      .expect(200);
    expect(readRes.body.some((transaction: any) => transaction.id === ORG_A_CREDIT_ID)).toBe(true);

    const createRes = await request(app)
      .post(`/api/customers/${ORG_A_CUSTOMER_ID}/credit-transactions`)
      .set(orgAHeaders)
      .send({ transactionType: "adjustment", amount: "5.00", description: "Same-org credit" })
      .expect(200);
    expect(createRes.body.customerId).toBe(ORG_A_CUSTOMER_ID);

    const patchRes = await request(app)
      .patch(`/api/customer-credit-transactions/${ORG_A_CREDIT_ID}`)
      .set(orgAHeaders)
      .send({ description: "Same-org patched credit" })
      .expect(200);
    expect(patchRes.body.description).toBe("Same-org patched credit");
  });
});
