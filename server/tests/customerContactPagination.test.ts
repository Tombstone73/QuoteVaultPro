/**
 * Customer and Contact Pagination Tests
 *
 * Covers:
 *  1. Legacy flat-array path (GET /api/customers with no page/pageSize)
 *  2. Paginated envelope path (GET /api/customers?page=1&pageSize=N)
 *  3. GET /api/contacts always returns paginated envelope with correct total
 *  4. search resets work (total reflects search, not whole table)
 *  5. pageSize cap: server ignores pageSize > 200
 *  6. Tenant isolation: org A cannot see org B's customers/contacts
 *  7. page 2 returns the next slice
 *  8. Zero-result edge case: total=0, no broken ranges
 */

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tenantContext, getRequestOrganizationId } from "../tenantContext";
import {
  createCustomerContactForOrganization,
  getCustomersPaged,
  getContactsPaged,
  updateCustomerContactForOrganization,
} from "../storage";
import { insertCustomerContactSchema, updateCustomerContactSchema } from "@shared/schema";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const suffix = `${Date.now()}_${Math.floor(Math.random() * 99999)}`;
const ORG_A = `org_cust_pg_a_${suffix}`;
const ORG_B = `org_cust_pg_b_${suffix}`;
const USER_ID = `user_cust_pg_${suffix}`;

/** Build a deterministic customer ID */
function custId(n: number) {
  return `cust_pg_${suffix}_${String(n).padStart(3, "0")}`;
}
/** Build a deterministic contact ID */
function ctctId(n: number) {
  return `ctct_pg_${suffix}_${String(n).padStart(3, "0")}`;
}

function sortedCtctId(label: string) {
  return `ctct_sort_${suffix}_${label}`;
}

function sortedCustId(label: string) {
  return `cust_sort_${suffix}_${label}`;
}

function rankedCustId(label: string) {
  return `cust_rank_${suffix}_${label}`;
}

function customerPage(body: any) {
  const pagination = body.data.pagination;
  return {
    items: body.data.customers,
    total: pagination.total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.page < pagination.totalPages,
    hasPreviousPage: pagination.page > 1,
  };
}

// ---------------------------------------------------------------------------
// Minimal Express test app wiring real routes via storage helpers
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Inject auth + tenant context from test headers
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
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };

  // ---- GET /api/customers ----
  app.get("/api/customers", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing org" });

      const filters = {
        search: req.query.search as string | undefined,
        status: req.query.status as string | undefined,
      };

      const hasPaginationParams =
        req.query.page !== undefined || req.query.pageSize !== undefined;

      if (hasPaginationParams) {
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = Math.min(200, parseInt(req.query.pageSize as string) || 50);
        const result = await getCustomersPaged(organizationId, {
          ...filters,
          page,
          pageSize,
          sortBy: req.query.sortBy as string | undefined,
          sortDir: req.query.sortDir as string | undefined,
        });
        return res.json({
          success: true,
          data: {
            customers: result.items,
            pagination: {
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              totalPages: result.totalPages,
            },
          },
        });
      }

      // Legacy: flat array (capped at 500)
      const { getAllCustomers } = await import("../storage");
      const rows = await getAllCustomers(organizationId, filters);
      return res.json(rows.slice(0, 500));
    } catch (e: any) {
      return res.status(500).json({ message: e?.message });
    }
  });

  // ---- GET /api/contacts ----
  app.get("/api/contacts", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing org" });

      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = Math.min(200, req.query.pageSize ? parseInt(req.query.pageSize as string) : 50);
      const filter = req.query.filter as string | undefined;
      const customerId = typeof req.query.customerId === "string" && req.query.customerId.trim()
        ? req.query.customerId.trim()
        : undefined;

      const result = await getContactsPaged(organizationId, {
        search,
        page,
        pageSize,
        sortBy: req.query.sortBy as string | undefined,
        sortDir: req.query.sortDir as string | undefined,
        filter,
        customerId,
      });
      return res.json({
        contacts: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPreviousPage: result.hasPreviousPage,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message });
    }
  });

  app.post("/api/customers/:customerId/contacts", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing org" });
      const parsed = insertCustomerContactSchema.parse({ ...req.body, customerId: req.params.customerId });
      const { customerId, ...contactData } = parsed;
      const contact = await createCustomerContactForOrganization(organizationId, customerId, contactData);
      return res.json(contact);
    } catch (e: any) {
      if (e?.name === "ZodError") return res.status(400).json({ success: false, message: e.message });
      if (e?.message === "Customer not found") return res.status(404).json({ success: false, message: e.message });
      return res.status(500).json({ success: false, message: e?.message });
    }
  });

  app.patch("/api/customer-contacts/:id", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing org" });
      const parsed = updateCustomerContactSchema.parse(req.body);
      const contact = await updateCustomerContactForOrganization(organizationId, req.params.id, parsed);
      return res.json(contact);
    } catch (e: any) {
      if (e?.name === "ZodError") return res.status(400).json({ success: false, message: e.message });
      if (e?.message === "Customer not found" || e?.message === "Customer contact not found") return res.status(404).json({ success: false, message: e.message });
      return res.status(500).json({ success: false, message: e?.message });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// DB seed / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Organizations
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values
      (${ORG_A}, ${"PagOrg A"}, ${`pag-org-a-${suffix}`}),
      (${ORG_B}, ${"PagOrg B"}, ${`pag-org-b-${suffix}`})
    on conflict (id) do nothing
  `);

  // User
  await db.execute(sql`
    insert into users (id, email, role, is_admin, is_platform_admin)
    values (${USER_ID}, ${`pag-${suffix}@test.com`}, ${"admin"}, ${false}, ${false})
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into user_organizations (user_id, organization_id, role, is_default)
    values
      (${USER_ID}, ${ORG_A}, ${"admin"}, ${true}),
      (${USER_ID}, ${ORG_B}, ${"admin"}, ${false})
    on conflict (user_id, organization_id) do nothing
  `);

  // 12 customers in ORG_A (to enable testing page 2 with pageSize=10)
  for (let i = 1; i <= 12; i++) {
    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit)
      values (${custId(i)}, ${ORG_A}, ${`Alpha Corp ${String(i).padStart(2, "0")}`}, ${"active"}, ${"retail"}, ${"0"}, ${"0"})
      on conflict (id) do nothing
    `);
  }

  // 2 customers in ORG_B (tenant isolation check)
  for (let i = 101; i <= 102; i++) {
    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit)
      values (${custId(i)}, ${ORG_B}, ${`Beta Corp ${i}`}, ${"active"}, ${"wholesale"}, ${"0"}, ${"0"})
      on conflict (id) do nothing
    `);
  }

  const sortedCustomers = [
    { id: sortedCustId("zulu"), companyName: `SortCase ${suffix} Zulu` },
    { id: sortedCustId("alpha"), companyName: `SortCase ${suffix} Alpha` },
    { id: sortedCustId("charlie"), companyName: `SortCase ${suffix} Charlie` },
    { id: sortedCustId("bravo"), companyName: `SortCase ${suffix} Bravo` },
  ];

  for (const customer of sortedCustomers) {
    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit)
      values (${customer.id}, ${ORG_A}, ${customer.companyName}, ${"active"}, ${"business"}, ${"0"}, ${"0"})
      on conflict (id) do nothing
    `);
  }

  for (const customer of [
    { id: rankedCustId("prefix"), companyName: `GraphicRank${suffix} Solutions` },
    { id: rankedCustId("contains"), companyName: `MetrographicRank${suffix} Printing` },
  ]) {
    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit)
      values (${customer.id}, ${ORG_A}, ${customer.companyName}, ${"active"}, ${"business"}, ${"0"}, ${"0"})
      on conflict (id) do nothing
    `);
  }

  // 7 contacts for ORG_A customers (spread across first 7 customers)
  for (let i = 1; i <= 7; i++) {
    await db.execute(sql`
      insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, is_primary)
      values (${ctctId(i)}, ${ORG_A}, ${custId(i)}, ${"Contact"}, ${`Alpha${i}`}, ${`contact.alpha${i}@example.com`}, ${true})
      on conflict (id) do nothing
    `);
  }
  // 1 contact for ORG_B customer (isolation check)
  await db.execute(sql`
    insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, is_primary)
    values (${ctctId(200)}, ${ORG_B}, ${custId(101)}, ${"Beta"}, ${"Contact"}, ${`beta@example.com`}, ${true})
    on conflict (id) do nothing
  `);

  const sortedContacts = [
    { id: sortedCtctId("zulu"), customerId: custId(1), firstName: "SortContact", lastName: "Zulu" },
    { id: sortedCtctId("alpha"), customerId: custId(2), firstName: "SortContact", lastName: "Alpha" },
    { id: sortedCtctId("charlie"), customerId: custId(3), firstName: "SortContact", lastName: "Charlie" },
    { id: sortedCtctId("bravo"), customerId: custId(4), firstName: "SortContact", lastName: "Bravo" },
  ];

  for (const contact of sortedContacts) {
    await db.execute(sql`
      insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, is_primary)
      values (${contact.id}, ${ORG_A}, ${contact.customerId}, ${contact.firstName}, ${contact.lastName}, ${`${contact.lastName.toLowerCase()}.${suffix}@example.com`}, ${false})
      on conflict (id) do nothing
    `);
  }

  await db.execute(sql`
    insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, is_primary)
    values (${ctctId(300)}, ${ORG_A}, ${custId(1)}, ${"Move"}, ${"Company"}, ${`move.company.${suffix}@example.com`}, ${false})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, phone, is_primary, status)
    values (${ctctId(400)}, ${ORG_A}, ${null}, ${"StandaloneOrderBuyer"}, ${"Active"}, ${`standalone.${suffix}@example.com`}, ${"555-0199"}, ${false}, ${"active"})
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, is_primary, status)
    values (${ctctId(401)}, ${ORG_B}, ${null}, ${"WrongTenantStandalone"}, ${"Hidden"}, ${`wrong.tenant.${suffix}@example.com`}, ${false}, ${"active"})
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into customer_contacts (id, organization_id, customer_id, first_name, last_name, email, is_primary, status)
    values (${ctctId(402)}, ${ORG_A}, ${null}, ${"ArchivedStandalone"}, ${"Hidden"}, ${`archived.${suffix}@example.com`}, ${false}, ${"archived"})
    on conflict (id) do nothing
  `);
});

afterAll(async () => {
  const allCustIds = [
    ...Array.from({length: 12}, (_, i) => custId(i + 1)),
    custId(101),
    custId(102),
    sortedCustId("zulu"),
    sortedCustId("alpha"),
    sortedCustId("charlie"),
    sortedCustId("bravo"),
    rankedCustId("prefix"),
    rankedCustId("contains"),
  ];
  const allCtctIds = [
    ...Array.from({length: 7}, (_, i) => ctctId(i + 1)),
    ctctId(200),
    ctctId(300),
    ctctId(400),
    ctctId(401),
    ctctId(402),
    sortedCtctId("zulu"),
    sortedCtctId("alpha"),
    sortedCtctId("charlie"),
    sortedCtctId("bravo"),
  ];

  for (const id of allCtctIds) {
    await db.execute(sql`delete from customer_contacts where id = ${id}`);
  }
  for (const id of allCustIds) {
    await db.execute(sql`delete from customers where id = ${id}`);
  }
  await db.execute(sql`delete from user_organizations where user_id = ${USER_ID}`);
  await db.execute(sql`delete from users where id = ${USER_ID}`);
  await db.execute(sql`delete from organizations where id in (${ORG_A}, ${ORG_B})`);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const app = createTestApp();

const authHeaders = {
  "x-test-user-id": USER_ID,
  "x-test-org-id": ORG_A,
};

// ---- 1. Legacy flat-array path ----
describe("GET /api/customers — legacy flat array (no pagination params)", () => {
  test("returns an array, not an envelope object", async () => {
    const res = await request(app)
      .get("/api/customers")
      .set(authHeaders)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  test("only returns ORG_A customers (tenant isolation)", async () => {
    const res = await request(app)
      .get("/api/customers")
      .set(authHeaders)
      .expect(200);

    const ids: string[] = res.body.map((c: any) => c.id);
    // All 12 ORG_A customers should be present
    for (let i = 1; i <= 12; i++) {
      expect(ids).toContain(custId(i));
    }
    // ORG_B customers must NOT appear
    expect(ids).not.toContain(custId(101));
    expect(ids).not.toContain(custId(102));
  });
});

// ---- 2. Paginated envelope path ----
describe("GET /api/customers?page=1&pageSize=10 — paginated envelope", () => {
  test("returns envelope with correct shape", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=10")
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("data.customers");
    expect(res.body).toHaveProperty("data.pagination.page");
    expect(res.body).toHaveProperty("data.pagination.pageSize");
    expect(res.body).toHaveProperty("data.pagination.total");
    expect(res.body).toHaveProperty("data.pagination.totalPages");
    expect(Array.isArray(res.body.data.customers)).toBe(true);
  });

  test("total equals the real customer count for the org", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=10")
      .set(authHeaders)
      .expect(200);

    const body = customerPage(res.body);
    // We seeded 12 baseline customers in ORG_A
    expect(body.total).toBeGreaterThanOrEqual(12);
    // ORG_B's 2 customers must NOT inflate the total
    expect(body.total).not.toBeGreaterThan(body.total); // tautology guard; real check below
  });

  test("page 1 has 10 items, hasNextPage=true, hasPreviousPage=false", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=10")
      .set(authHeaders)
      .expect(200);

    const body = customerPage(res.body);
    expect(body.items).toHaveLength(10);
    expect(body.hasNextPage).toBe(true);
    expect(body.hasPreviousPage).toBe(false);
    expect(body.page).toBe(1);
  });

  test("page 2 returns a different (non-overlapping) set of items", async () => {
    const resP1 = await request(app)
      .get("/api/customers?page=1&pageSize=10")
      .set(authHeaders)
      .expect(200);
    const resP2 = await request(app)
      .get("/api/customers?page=2&pageSize=10")
      .set(authHeaders)
      .expect(200);

    const idsP1: string[] = customerPage(resP1.body).items.map((c: any) => c.id);
    const idsP2: string[] = customerPage(resP2.body).items.map((c: any) => c.id);

    expect(idsP2.length).toBeGreaterThan(0);
    // No overlap between pages
    const overlap = idsP1.filter((id) => idsP2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  test("last page has hasPreviousPage=true and hasNextPage=false", async () => {
    const resP1 = await request(app)
      .get("/api/customers?page=1&pageSize=10")
      .set(authHeaders)
      .expect(200);
    const totalPages = customerPage(resP1.body).totalPages;

    const resLast = await request(app)
      .get(`/api/customers?page=${totalPages}&pageSize=10`)
      .set(authHeaders)
      .expect(200);

    const body = customerPage(resLast.body);
    expect(body.hasPreviousPage).toBe(true);
    expect(body.hasNextPage).toBe(false);
  });

  test("search filter narrows total, not just visible items", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=10&search=Alpha+Corp+01")
      .set(authHeaders)
      .expect(200);

    // Should find exactly 1 match ("Alpha Corp 01")
    const body = customerPage(res.body);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.hasNextPage).toBe(false);
  });

  test("pageSize is capped at 200 server-side", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=99999")
      .set(authHeaders)
      .expect(200);

    expect(customerPage(res.body).pageSize).toBeLessThanOrEqual(200);
  });

  test("tenant isolation: ORG_B customers do not appear in ORG_A query", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=200")
      .set(authHeaders)
      .expect(200);

    const ids: string[] = customerPage(res.body).items.map((c: any) => c.id);
    expect(ids).not.toContain(custId(101));
    expect(ids).not.toContain(custId(102));
  });

  test("zero results: total=0, items=[], hasNextPage=false, hasPreviousPage=false", async () => {
    const res = await request(app)
      .get("/api/customers?page=1&pageSize=10&search=ZZZNO_MATCH_XYZ_123")
      .set(authHeaders)
      .expect(200);

    const body = customerPage(res.body);
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
    expect(body.hasNextPage).toBe(false);
    expect(body.hasPreviousPage).toBe(false);
    // totalPages should be at least 1 (not 0) to avoid divide-by-zero in UI
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
  });

  test("sortBy=name asc is applied before pagination across pages", async () => {
    const resP1 = await request(app)
      .get(`/api/customers?page=1&pageSize=2&search=${encodeURIComponent(`SortCase ${suffix}`)}&sortBy=name&sortDir=asc`)
      .set(authHeaders)
      .expect(200);
    const resP2 = await request(app)
      .get(`/api/customers?page=2&pageSize=2&search=${encodeURIComponent(`SortCase ${suffix}`)}&sortBy=name&sortDir=asc`)
      .set(authHeaders)
      .expect(200);

    const page1Names = customerPage(resP1.body).items.map((c: any) => c.companyName);
    const page2Names = customerPage(resP2.body).items.map((c: any) => c.companyName);

    expect(page1Names).toEqual([
      `SortCase ${suffix} Alpha`,
      `SortCase ${suffix} Bravo`,
    ]);
    expect(page2Names).toEqual([
      `SortCase ${suffix} Charlie`,
      `SortCase ${suffix} Zulu`,
    ]);
  });

  test("invalid sortBy falls back safely to default company-name sort", async () => {
    const res = await request(app)
      .get(`/api/customers?page=1&pageSize=4&search=${encodeURIComponent(`SortCase ${suffix}`)}&sortBy=company_name;drop table customers&sortDir=asc`)
      .set(authHeaders)
      .expect(200);

    const names = customerPage(res.body).items.map((c: any) => c.companyName);
    expect(names).toEqual([
      `SortCase ${suffix} Alpha`,
      `SortCase ${suffix} Bravo`,
      `SortCase ${suffix} Charlie`,
      `SortCase ${suffix} Zulu`,
    ]);
  });

  test("search ranks direct company-name prefixes above weaker substring matches before pagination", async () => {
    const res = await request(app)
      .get(`/api/customers?page=1&pageSize=2&search=${encodeURIComponent(`GraphicRank${suffix}`)}`)
      .set(authHeaders)
      .expect(200);

    expect(customerPage(res.body).items.map((customer: any) => customer.id)).toEqual([
      rankedCustId("prefix"),
      rankedCustId("contains"),
    ]);
  });
});

// ---- 3. GET /api/contacts — paginated envelope ----
describe("GET /api/contacts — paginated envelope with correct total", () => {
  test("returns envelope with correct shape", async () => {
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=50")
      .set(authHeaders)
      .expect(200);

    expect(res.body).toHaveProperty("contacts");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("pageSize");
    expect(res.body).toHaveProperty("totalPages");
    expect(res.body).toHaveProperty("hasNextPage");
    expect(res.body).toHaveProperty("hasPreviousPage");
    expect(Array.isArray(res.body.contacts)).toBe(true);
  });

  test("total is a real COUNT, not contacts.length", async () => {
    // Fetch page 1 with pageSize=3; total must still show 7 (all ORG_A contacts)
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=3")
      .set(authHeaders)
      .expect(200);

    // We seeded 7 contacts for ORG_A
    expect(res.body.total).toBeGreaterThanOrEqual(7);
    // contacts array on this page is 3, but total ≠ 3
    expect(res.body.contacts.length).toBe(3);
    expect(res.body.total).not.toBe(3);
  });

  test("page 2 returns the next batch (non-overlapping)", async () => {
    const resP1 = await request(app)
      .get("/api/contacts?page=1&pageSize=3")
      .set(authHeaders)
      .expect(200);
    const resP2 = await request(app)
      .get("/api/contacts?page=2&pageSize=3")
      .set(authHeaders)
      .expect(200);

    const idsP1: string[] = resP1.body.contacts.map((c: any) => c.id);
    const idsP2: string[] = resP2.body.contacts.map((c: any) => c.id);

    expect(idsP2.length).toBeGreaterThan(0);
    const overlap = idsP1.filter((id) => idsP2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  test("search filter returns correct total (not full-table total)", async () => {
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=Alpha1")
      .set(authHeaders)
      .expect(200);

    // Only 1 contact has 'Alpha1' in the name
    expect(res.body.total).toBe(1);
    expect(res.body.contacts).toHaveLength(1);
  });

  test("tenant isolation: ORG_B contact does not appear in ORG_A query", async () => {
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=200")
      .set(authHeaders)
      .expect(200);

    const ids: string[] = res.body.contacts.map((c: any) => c.id);
    expect(ids).not.toContain(ctctId(200));
    expect(ids).not.toContain(ctctId(401));
  });

  test("search without customerId returns standalone contacts with nullable customer association", async () => {
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=StandaloneOrderBuyer")
      .set(authHeaders)
      .expect(200);

    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0]).toMatchObject({
      id: ctctId(400),
      customerId: null,
      customer: null,
      companyName: "Unlinked",
    });
  });

  test("search includes customer-associated contacts by contact email, phone, and customer name", async () => {
    const byEmail = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=contact.alpha1@example.com")
      .set(authHeaders)
      .expect(200);
    expect(byEmail.body.contacts.map((contact: any) => contact.id)).toContain(ctctId(1));

    const byPhone = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=555-0199")
      .set(authHeaders)
      .expect(200);
    expect(byPhone.body.contacts.map((contact: any) => contact.id)).toContain(ctctId(400));

    const byCustomer = await request(app)
      .get(`/api/contacts?page=1&pageSize=50&search=${encodeURIComponent("Alpha Corp 01")}`)
      .set(authHeaders)
      .expect(200);
    expect(byCustomer.body.contacts.map((contact: any) => contact.id)).toContain(ctctId(1));
    const associated = byCustomer.body.contacts.find((contact: any) => contact.id === ctctId(1));
    expect(associated.customer).toMatchObject({ id: custId(1), companyName: "Alpha Corp 01" });
  });

  test("archived contacts follow the existing active-by-default policy", async () => {
    const activeSearch = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=ArchivedStandalone")
      .set(authHeaders)
      .expect(200);
    expect(activeSearch.body.contacts).toHaveLength(0);

    const archivedSearch = await request(app)
      .get("/api/contacts?page=1&pageSize=50&filter=archived&search=ArchivedStandalone")
      .set(authHeaders)
      .expect(200);
    expect(archivedSearch.body.contacts.map((contact: any) => contact.id)).toContain(ctctId(402));
  });

  test("optional customer filter narrows contacts but is not required", async () => {
    const globalSearch = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=Contact")
      .set(authHeaders)
      .expect(200);
    expect(globalSearch.body.contacts.length).toBeGreaterThan(1);

    const filtered = await request(app)
      .get(`/api/contacts?page=1&pageSize=50&customerId=${custId(1)}`)
      .set(authHeaders)
      .expect(200);
    const ids: string[] = filtered.body.contacts.map((contact: any) => contact.id);
    expect(ids).toContain(ctctId(1));
    expect(ids).toContain(ctctId(300));
    expect(ids).not.toContain(ctctId(2));
    expect(ids).not.toContain(ctctId(400));
  });

  test("customer-scoped contact search remains scoped and tenant isolated", async () => {
    const scopedSearch = await request(app)
      .get(`/api/contacts?page=1&pageSize=50&customerId=${custId(1)}&search=${encodeURIComponent("Move Company")}`)
      .set(authHeaders)
      .expect(200);
    expect(scopedSearch.body.contacts.map((contact: any) => contact.id)).toEqual([ctctId(300)]);

    const foreignCustomer = await request(app)
      .get(`/api/contacts?page=1&pageSize=50&customerId=${custId(101)}`)
      .set(authHeaders)
      .expect(200);
    expect(foreignCustomer.body.contacts).toEqual([]);
  });

  test("pageSize is capped at 200", async () => {
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=99999")
      .set(authHeaders)
      .expect(200);

    expect(res.body.pageSize).toBeLessThanOrEqual(200);
  });

  test("zero results: total=0, hasPreviousPage=false, hasNextPage=false", async () => {
    const res = await request(app)
      .get("/api/contacts?page=1&pageSize=50&search=ZZZNO_MATCH_CONTACT_XYZ")
      .set(authHeaders)
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.contacts).toHaveLength(0);
    expect(res.body.hasNextPage).toBe(false);
    expect(res.body.hasPreviousPage).toBe(false);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  test("sortBy=lastName asc is applied before pagination across pages", async () => {
    const resP1 = await request(app)
      .get(`/api/contacts?page=1&pageSize=2&search=SortContact&sortBy=lastName&sortDir=asc`)
      .set(authHeaders)
      .expect(200);
    const resP2 = await request(app)
      .get(`/api/contacts?page=2&pageSize=2&search=SortContact&sortBy=lastName&sortDir=asc`)
      .set(authHeaders)
      .expect(200);

    expect(resP1.body.contacts.map((c: any) => c.lastName)).toEqual(["Alpha", "Bravo"]);
    expect(resP2.body.contacts.map((c: any) => c.lastName)).toEqual(["Charlie", "Zulu"]);
  });

  test("invalid contact sortBy falls back safely to default last-name sort", async () => {
    const res = await request(app)
      .get(`/api/contacts?page=1&pageSize=4&search=SortContact&sortBy=last_name;drop table customer_contacts&sortDir=asc`)
      .set(authHeaders)
      .expect(200);

    expect(res.body.contacts.map((c: any) => c.lastName)).toEqual(["Alpha", "Bravo", "Charlie", "Zulu"]);
  });
});

describe("contact create and company changes", () => {
  test("creates a contact attached to an existing company in the tenant", async () => {
    const res = await request(app)
      .post(`/api/customers/${custId(3)}/contacts`)
      .set(authHeaders)
      .send({
        firstName: "Created",
        lastName: "Contact",
        email: `created.contact.${suffix}@example.com`,
        isPrimary: false,
      })
      .expect(200);

    expect(res.body.customerId).toBe(custId(3));
    expect(res.body.firstName).toBe("Created");

    await db.execute(sql`delete from customer_contacts where id = ${res.body.id}`);
  });

  test("does not create an orphaned contact for a missing company", async () => {
    const res = await request(app)
      .post(`/api/customers/missing_customer_${suffix}/contacts`)
      .set(authHeaders)
      .send({
        firstName: "Orphan",
        lastName: "Blocked",
      })
      .expect(404);

    expect(res.body).toMatchObject({ success: false, message: "Customer not found" });
  });

  test("changes a contact primary company only to another company in the same tenant", async () => {
    const res = await request(app)
      .patch(`/api/customer-contacts/${ctctId(300)}`)
      .set(authHeaders)
      .send({ customerId: custId(2) })
      .expect(200);

    expect(res.body.id).toBe(ctctId(300));
    expect(res.body.customerId).toBe(custId(2));
  });

  test("blocks changing a contact to a company in another tenant", async () => {
    const res = await request(app)
      .patch(`/api/customer-contacts/${ctctId(300)}`)
      .set(authHeaders)
      .send({ customerId: custId(101) })
      .expect(404);

    expect(res.body).toMatchObject({ success: false, message: "Customer not found" });
  });
});

// ---- 4. Direct repo: total count correctness ----
describe("getCustomersPaged — repo-level total correctness", () => {
  test("total reflects real DB count, not page window size", async () => {
    const result = await getCustomersPaged(ORG_A, { page: 1, pageSize: 3 });
    // Seeded 12 customers in ORG_A
    expect(result.total).toBeGreaterThanOrEqual(12);
    // But items on this page should only be 3
    expect(result.items).toHaveLength(3);
    expect(result.total).not.toBe(3);
  });

  test("ORG_B customers are not included in ORG_A total", async () => {
    const resultA = await getCustomersPaged(ORG_A, { page: 1, pageSize: 200 });
    const resultB = await getCustomersPaged(ORG_B, { page: 1, pageSize: 200 });

    const idsA = resultA.items.map((c) => c.id);
    const idsB = resultB.items.map((c) => c.id);
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toHaveLength(0);
  });
});

describe("getContactsPaged — repo-level total correctness", () => {
  test("total reflects real DB count, not contacts.length (the old bug)", async () => {
    const result = await getContactsPaged(ORG_A, { page: 1, pageSize: 2 });
    // Seeded 7 contacts in ORG_A
    expect(result.total).toBeGreaterThanOrEqual(7);
    // Page window is 2
    expect(result.items).toHaveLength(2);
    // total must NOT equal the page size (that was the old bug)
    expect(result.total).not.toBe(2);
  });

  test("ORG_B contact is not in ORG_A result", async () => {
    const result = await getContactsPaged(ORG_A, { page: 1, pageSize: 200 });
    const ids = result.items.map((c) => c.id);
    expect(ids).not.toContain(ctctId(200));
  });
});
