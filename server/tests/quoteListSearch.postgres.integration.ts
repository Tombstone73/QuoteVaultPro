import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { db, pool } from "../db";
import { customers, customerContacts, orders, organizations, quotes, users } from "@shared/schema";
import { QuotesRepository } from "../storage/quotes.repo";
import { registerQuoteRoutes } from "../routes/quotes.routes";

const org = `quote-search-${randomUUID()}`;
const otherOrg = `quote-search-other-${randomUUID()}`;
const actor = randomUUID();
const otherActor = randomUUID();
const customerId = randomUUID();
const contactId = randomUUID();
const targetId = randomUUID();
const repo = new QuotesRepository(db);

function application(organizationId = org, role = "owner", userId = actor) {
    const app = express();
    const context: express.RequestHandler = (req, _res, next) => {
        Object.assign(req, { organizationId, user: { id: userId }, actorOrgRole: role });
        next();
    };
    registerQuoteRoutes(app, { isAuthenticated: context, tenantContext: context, isAdmin: context });
    return app;
}
const app = application();
async function list(search: string, extra: Record<string, string | number> = {}, instance = app) {
    const response = await request(instance).get("/api/quotes").query({
        search, source: "internal", page: 1, pageSize: 25, sortBy: "date", sortDir: "desc", ...extra,
    });
    expect(response.status).toBe(200);
    return response.body;
}

beforeAll(async () => {
    await db.insert(organizations).values([
        { id: org, name: "Quote search isolated QA", slug: org },
        { id: otherOrg, name: "Other search tenant", slug: otherOrg },
    ]);
    await db.insert(users).values([
        { id: actor, email: `${actor}@example.invalid` },
        { id: otherActor, email: `${otherActor}@example.invalid` },
    ]);
    await db.insert(customers).values({ id: customerId, organizationId: org, companyName: "Office Hub" });
    await db.insert(customerContacts).values({ id: contactId, organizationId: org, customerId, firstName: "Alex", lastName: "Search", email: "quotes@example.invalid" });
    await db.insert(quotes).values([
        { id: targetId, organizationId: org, userId: actor, customerId, contactId, quoteNumber: 20900,
            label: "24×36 Foam", status: "draft", createdAt: new Date("2026-01-01T12:00:00Z") },
        ...Array.from({ length: 30 }, (_, index) => ({ organizationId: org, userId: actor,
            quoteNumber: 21000 + index, label: "Page filler", status: "active" as const,
            createdAt: new Date(`2026-02-${String(index % 28 + 1).padStart(2, "0")}T12:00:00Z`) })),
        { organizationId: otherOrg, userId: actor, quoteNumber: 20900, label: "Other tenant" },
        { organizationId: org, userId: otherActor, quoteNumber: 20901, displayNumber: "QT-20901", numberCore: 20901, label: "Other author" },
        { organizationId: org, userId: actor, quoteNumber: 20902, numberCore: 30902, label: "Literal 50%_discount" },
    ]);
    // Quotes have no independent PO field. Search their canonical linked Order PO when present.
    await db.insert(orders).values({ organizationId: org, orderNumber: "QA-PO", quoteId: targetId,
        customerId, poNumber: "OH-REFERENCE-777", createdByUserId: actor });
});
afterAll(async () => { await pool.end(); });

describe("authorized Quote list search through route and real PostgreSQL", () => {
    test("reproduces the old customer-only failure and finds 20900 beyond the loaded page", async () => {
        const old = await repo.getUserQuotesPaginated(org, actor, { userRole: "owner", searchCustomer: "20900", page: 1, pageSize: 25, includeThumbnails: false });
        expect(old.totalCount).toBe(0);
        const unfiltered = await list("");
        expect(unfiltered.items.some((row: { id: string }) => row.id === targetId)).toBe(false);
        const found = await list("20900");
        expect(found.totalCount).toBe(1);
        expect(found.items[0]).toMatchObject({ id: targetId, quoteNumber: 20900, customerName: "Office Hub", label: "24×36 Foam", status: "draft" });
    });
    test.each(["QT-20900", "qt-20900", " office HUB ", "24×36 Foam", "Foam", "OH-REFERENCE-777", "REFERENCE-77", "Alex Search"])("matches %s", async term => {
        expect((await list(term)).items.map((row: { id: string }) => row.id)).toEqual([targetId]);
    });
    test("matches modern display/core identities and treats wildcard input as literal text", async () => {
        expect((await list("QT-20901")).totalCount).toBe(1);
        expect((await list("30902")).totalCount).toBe(1);
        expect((await list("50%_")).totalCount).toBe(1);
        expect((await list("QT")).totalCount).toBe(1);
        expect((await list("missing-20999")).totalCount).toBe(0);
    });
    test("count, pagination and sorting use the same complete filtered dataset", async () => {
        const first = await list("Page filler", { pageSize: 10, sortBy: "quoteNumber", sortDir: "asc" });
        const second = await list("Page filler", { pageSize: 10, page: 2, sortBy: "quoteNumber", sortDir: "asc" });
        expect(first).toMatchObject({ totalCount: 30, totalPages: 3, hasNext: true, hasPrev: false });
        expect(first.items[0].quoteNumber).toBe(21000);
        expect(second.items[0].quoteNumber).toBe(21010);
        expect(second).toMatchObject({ page: 2, totalCount: 30, hasPrev: true });
    });
    test("status, dates, visibility, source and role restrictions remain effective", async () => {
        expect((await list("Foam", { status: "converted" })).totalCount).toBe(1);
        expect((await list("Foam", { status: "sent" })).totalCount).toBe(0);
        expect((await list("Foam", { startDate: "2026-02-01" })).totalCount).toBe(0);
        expect((await list("Foam", { endDate: "2026-01-02" })).totalCount).toBe(1);
        expect((await list("Foam", { portalVisibility: "visible" })).totalCount).toBe(0);
        expect((await list("Foam", { source: "customer_quick_quote" })).totalCount).toBe(0);
        expect((await list("20900", {}, application(org, "employee", otherActor))).totalCount).toBe(0);
        expect((await list("20900", {}, application(org, "employee"))).totalCount).toBe(1);
    });
    test("tenant scope includes linked customer/contact and PO matches", async () => {
        expect((await list("20900", {}, application(otherOrg))).items[0].label).toBe("Other tenant");
        expect((await list("Office Hub", {}, application(otherOrg))).totalCount).toBe(0);
        expect((await list("REFERENCE", {}, application(otherOrg))).totalCount).toBe(0);
        expect((await list("Alex Search", {}, application(otherOrg))).totalCount).toBe(0);
    });
    test("unpaginated API and all-matching export retain the search", async () => {
        const response = await request(app).get("/api/quotes").query({ search: "QT-20900", source: "internal" });
        expect(response.status).toBe(200);
        expect(response.body.map((row: { id: string }) => row.id)).toEqual([targetId]);
        const csv = await request(app).get("/api/quotes/export.csv").query({ search: "20900", source: "internal" });
        expect(csv.status).toBe(200);
        expect(csv.text).toContain("24×36 Foam");
        expect(csv.text).not.toContain("Page filler");
    });
});
